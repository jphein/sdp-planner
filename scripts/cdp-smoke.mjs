#!/usr/bin/env node
// End-to-end smoke test: drive index.html in headless Chrome over CDP.
//
//   node scripts/cdp-smoke.mjs [--root DIR | path/to/index.html | https://host/path/]
//   (with a URL, the page comes from there; the fixtures are still read from this checkout's disk)
//
// It checks the parsers against tests/fixtures (the same workbooks a user would drop in) and the
// calculator in demo mode and with the fixtures loaded: rows render, hr/wk → hr/yr and the stamp,
// fill closes a pot to $0, a start-month change keeps hr/wk, undo, scenarios, editable budgets,
// and no uncaught exceptions. Exits 1 on any failure.
//
// It drives the DOM hooks listed in tests/e2e/README.md ("Selector contract").
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, pageUrl, runner, assert, near } from './lib/cdp.mjs';

const here = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const rootArg = args.includes('--root') ? args[args.indexOf('--root') + 1] : args.find(a => !a.startsWith('--')) || here;
const url = pageUrl(rootArg);
const fixtures = join(here, 'tests', 'fixtures');
const expected = JSON.parse(readFileSync(join(fixtures, 'expected.json'), 'utf8'));
const b64 = f => readFileSync(join(fixtures, f)).toString('base64');

// In-page helpers. Reads prefer SDP.app.state(); DOM text is the fallback.
const QA = `window.__qa = {
  // hook aliases: the canonical key first, older names after (the private page used t/c/st)
  K: { provider:['provider','t'], code:['code','c'], start:['start','st'], service:['service','svc'] },
  num(s){ if(s==null) return NaN; s=String(s).replace(/[\\u2212\\u2013]/g,'-'); const neg=/^\\s*-|\\(.*\\)/.test(s); const v=parseFloat(s.replace(/[^0-9.]/g,'')); return neg?-v:v; },
  rows(){ return [...document.querySelectorAll('#calcBody tr')].filter(r=>r.querySelector('[data-k]')); },
  el(r,k){ for(const a of (this.K[k]||[k])){ const e=r.querySelector('[data-k="'+a+'"]'); if(e) return e; } return null; },
  val(r,k){ const e=this.el(r,k); return e? e.value : undefined; },
  set(el,v,ev){ el.focus(); el.value=v; el.dispatchEvent(new Event(ev||'input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); el.blur(); },
  // {lines, auth}: SDP.app.state() if the page exposes it, else the page's own saved state.
  state(){ try { if (window.SDP && SDP.app && typeof SDP.app.state==='function') return JSON.parse(JSON.stringify(SDP.app.state()));
    const s=JSON.parse(localStorage.getItem('sdp-planner:v1')||'null'); return s && s.lines ? s : null; } catch(e){ return null; } },
  authOf(st,c){ const a=st && st.auth && st.auth[c]; return a && typeof a==='object' ? a.auth : a; },
  head(code){ const e=document.querySelector('[data-head="'+code+'"]'); if(e) return this.num(e.textContent);
    const st=this.state(); if(!st) return NaN; const f=SDP.model.forecast(st.lines, st.auth); return f && f.byCode && f.byCode[code] ? f.byCode[code].headroom : NaN; },
  stamp(){ const e=document.getElementById('stamp'); return e? e.textContent.trim() : null; },
  hourly(){ return this.rows().findIndex(r=>{ const rate=this.num(this.val(r,'rate')); const wk=r.querySelector('[data-k="wk"]'); return rate>0 && wk && !wk.disabled && !wk.readOnly; }); },
};`;

const T = runner('cdp-smoke');
const { check } = T;
const cdp = await launch();
const ev = cdp.evaluate;
let exitCode = 1;
try {
  console.log(`page: ${url}`);
  await cdp.navigate(url);
  await ev(QA);

  await check('window.SDP present with parsers, model, demo', async () => {
    const s = await ev(`({p:!!(window.SDP&&SDP.parsers&&SDP.parsers.parse), m:!!(window.SDP&&SDP.model&&SDP.model.forecast), d:!!(window.SDP&&SDP.demo&&SDP.demo.plan), x:typeof XLSX})`);
    assert(s.p && s.m && s.d, `missing: ${JSON.stringify(s)}`); assert(s.x === 'object', `XLSX global is ${s.x}`);
  });

  // ---------------------------------------------------------------- parsers on fixtures
  await ev(`window.__wb = f => XLSX.read(Uint8Array.from(atob(f), c => c.charCodeAt(0)), {type:'array'});`);
  const plan = await ev(`(()=>{ const wb=__wb(${JSON.stringify(b64('ace-plan.xlsx'))}); return {kind:SDP.parsers.detect(wb), r:SDP.parsers.parse(wb)}; })()`).catch(e => ({ error: e.message }));
  const rep = await ev(`(()=>{ const wb=__wb(${JSON.stringify(b64('ace-report.xlsx'))}); return {kind:SDP.parsers.detect(wb), r:SDP.parsers.parse(wb)}; })()`).catch(e => ({ error: e.message }));
  const P = plan.r?.data, R = rep.r?.data, E = expected;

  await check('detect(ace-plan.xlsx) = ace-plan', () => { assert(!plan.error, plan.error); assert(plan.kind === 'ace-plan', `got ${plan.kind}`); });
  await check('detect(ace-report.xlsx) = ace-report', () => { assert(!rep.error, rep.error); assert(rep.kind === 'ace-report', `got ${rep.kind}`); });
  await check('plan: planYear, total, per-code auth', () => {
    assert(P, 'no plan data');
    assert(P.planYear?.start === E.plan.planYear.start && P.planYear?.end === E.plan.planYear.end, `planYear ${JSON.stringify(P.planYear)}`);
    assert(near(P.total, E.plan.total), `total ${P.total} ≠ ${E.plan.total}`);
    for (const [c, a] of Object.entries(E.plan.codes)) assert(near(P.codes?.[c]?.auth, a), `SC-${c} auth ${P.codes?.[c]?.auth} ≠ ${a}`);
    const extra = Object.keys(P.codes || {}).filter(c => !(c in E.plan.codes)); assert(!extra.length, `unexpected codes ${extra} (FMS 316 is not a budget code)`);
  });
  await check('plan: lines with RATE column rates and fms vendor', () => {
    assert(Array.isArray(P?.lines), 'no lines');
    const budgetLines = P.lines.filter(l => String(l.code) !== '316');
    assert(budgetLines.length === E.plan.lineCount, `${budgetLines.length} budget lines ≠ ${E.plan.lineCount}`);
    for (const el of E.plan.lines) {
      const l = budgetLines.find(x => String(x.code) === el.code && near(x.yearly, el.yearly) && (x.providers || []).join('|') === el.providers.join('|'));
      assert(l, `missing line SC-${el.code} ${el.providers.join(' or ')} $${el.yearly}`);
      assert(near(l.rate, el.rate), `SC-${el.code} ${el.providers[0]} rate ${l.rate} ≠ ${el.rate}`);
      assert(Number(l.unitsPerYear) === el.unitsPerYear, `SC-${el.code} ${el.providers[0]} unitsPerYear ${l.unitsPerYear} ≠ ${el.unitsPerYear}`);
    }
    assert(P.fms?.vendorNumber === E.plan.fms.vendorNumber, `fms.vendorNumber ${P.fms?.vendorNumber}`);
    return `${budgetLines.length} lines`;
  });
  await check('report: rows, per-code spent/available, providers', () => {
    assert(R, 'no report data');
    const rows = (R.rows || []).filter(r => Number(r.spent) !== 0 || r.provider);
    assert(rows.length === E.report.rowCount, `${rows.length} transaction rows ≠ ${E.report.rowCount}`);
    for (const [c, v] of Object.entries(E.report.byCode)) {
      assert(near(R.byCode?.[c]?.spent ?? 0, v.spent), `SC-${c} spent ${R.byCode?.[c]?.spent} ≠ ${v.spent}`);
      if (R.byCode?.[c]?.available != null) assert(near(R.byCode[c].available, v.available), `SC-${c} available ${R.byCode[c].available} ≠ ${v.available}`);
    }
    for (const [p, s] of Object.entries(E.report.byProvider)) assert(near(R.byProvider?.[p], s), `provider ${p} ${R.byProvider?.[p]} ≠ ${s}`);
    const sum = rows.reduce((a, r) => a + Number(r.spent), 0); assert(near(sum, E.report.spentTotal), `rows sum ${sum} ≠ ${E.report.spentTotal}`);
  });
  await check('report: ledger ties to its own SVC + Provider sheets (checks.ok)', () => {
    assert(R?.checks, 'no data.checks from the parser');
    assert(R.checks.ok === true, `checks.ok=${R.checks.ok} mismatches ${JSON.stringify(R.checks.mismatches)}`);
  });
  await check('report: swapped-code invoice kept under its BOOKED codes', () => {
    const sw = E.report.swappedInvoice;
    const lines = (R?.rows || []).filter(r => String(r.invoice ?? '') === sw.invoice);
    assert(lines.length === sw.lines.length, `invoice ${sw.invoice}: ${lines.length} rows (does the parser read invoice# from the copy sheet?)`);
    for (const x of sw.lines) assert(lines.some(r => String(r.code) === x.code && near(r.spent, x.spent)), `invoice ${sw.invoice} SC-${x.code} $${x.spent} not found as booked`);
  });

  // ---------------------------------------------------------------- the calculator
  async function calculatorChecks(tag) {
    await check(`${tag}: calculator rows render`, async () => {
      const n = await ev(`__qa.rows().length`); assert(n > 0, 'no #calcBody rows'); return `${n} rows`;
    });
    const i = await ev(`__qa.hourly()`);
    await check(`${tag}: an editable hourly line exists`, () => assert(i >= 0, 'no row with rate>0 and an editable [data-k=wk]'));
    if (i < 0) return;
    const R0 = `__qa.rows()[${i}]`;
    const before = await ev(`({st:__qa.val(${R0},'start'), code:__qa.val(${R0},'code'), stamp:__qa.stamp()})`);
    const yearEnd = await ev(`(__qa.state()&&__qa.state().yearEnd) || (SDP.app&&SDP.app.yearEnd) || null`);

    await check(`${tag}: hr/wk edit updates hr/yr, $ and the stamp`, async () => {
      const r = await ev(`(()=>{ const r=${R0}; __qa.set(r.querySelector('[data-k="wk"]'),'5'); const r2=__qa.rows()[${i}];
        return {wk:__qa.num(__qa.val(r2,'wk')), hrs:__qa.num(__qa.val(r2,'hrs')), dol:__qa.num(__qa.val(r2,'dol')), rate:__qa.num(__qa.val(r2,'rate')), st:__qa.val(r2,'start'), stamp:__qa.stamp()}; })()`);
      assert(r.wk === 5, `hr/wk reads ${r.wk}`);
      const weeks = await ev(`SDP.model.weeksFrom(${JSON.stringify(r.st)}, ${JSON.stringify(yearEnd)})`).catch(() => null);
      if (weeks) assert(near(r.hrs, 5 * weeks, 0.051), `hr/yr ${r.hrs} ≠ 5 × ${weeks} wk`);
      else assert(r.hrs > 0, `hr/yr ${r.hrs}`);
      assert(near(r.dol, r.hrs * r.rate, r.rate * 0.05 + 0.01), `$ ${r.dol} ≠ ${r.hrs} × ${r.rate}`); // hr/yr shows 1 decimal
      assert(r.stamp && /FITS|OVER/i.test(r.stamp), `stamp "${r.stamp}"`);
      const big = await ev(`(()=>{ __qa.set(${R0}.querySelector('[data-k="wk"]'),'500'); return __qa.stamp(); })()`);
      assert(/OVER/i.test(big), `500 hr/wk should read OVER, stamp "${big}"`);
      return `hrs ${r.hrs}${weeks ? ` (= 5 × ${weeks} wk)` : ''}, stamp ${r.stamp} → ${big}`;
    });

    await check(`${tag}: fill closes the pot to $0`, async () => {
      const r = await ev(`(()=>{ const b=${R0}.querySelector('[data-fill]'); if(!b) return {err:'no [data-fill] button'}; b.click();
        const code=__qa.val(__qa.rows()[${i}],'code'); return {code, head:__qa.head(code), stamp:__qa.stamp()}; })()`);
      assert(!r.err, r.err);
      const head = r.head;
      assert(r.code, 'row has no [data-k=code]');
      assert(!Number.isNaN(head) && head != null, `no [data-head="${r.code}"], no SDP.app.state(), no saved state`);
      assert(near(head, 0, 0.01), `SC-${r.code} headroom after fill = ${head}`);
      assert(/FITS/i.test(r.stamp), `stamp after fill "${r.stamp}"`);
      return `SC-${r.code} headroom ${head}`;
    });

    let preStart = null;
    await check(`${tag}: start-month change keeps hr/wk, lowers hr/yr`, async () => {
      const r = await ev(`(()=>{ const r=${R0}; const s=__qa.el(r,'start'); if(!s) return {err:'no [data-k=start]'};
        const opts=[...s.options].map(o=>o.value); const wk0=__qa.num(__qa.val(r,'wk')), hrs0=__qa.num(__qa.val(r,'hrs')), st0=s.value;
        const target=opts[Math.min(opts.length-1, Math.max(opts.indexOf(st0),0)+4)];
        s.focus(); s.value=target; s.dispatchEvent(new Event('change',{bubbles:true})); // focus first, as a user would (pages may snapshot undo on focusin)
        const r2=__qa.rows()[${i}]; return {st0, target, wk0, hrs0, wk:__qa.num(__qa.val(r2,'wk')), hrs:__qa.num(__qa.val(r2,'hrs')), st:__qa.val(r2,'start')}; })()`);
      assert(!r.err, r.err);
      assert(r.st === r.target, `start ${r.st} ≠ ${r.target}`);
      assert(near(r.wk, r.wk0, 0.051), `hr/wk moved ${r.wk0} → ${r.wk}`);
      assert(r.hrs < r.hrs0, `hr/yr did not drop (${r.hrs0} → ${r.hrs})`);
      preStart = { st: r.st0, hrs: r.hrs0 };
      return `${r.st0}→${r.st}: ${r.wk} hr/wk, hr/yr ${r.hrs0}→${r.hrs}`;
    });

    await check(`${tag}: undo restores the previous start month`, async () => {
      const r = await ev(`(()=>{ const u=document.getElementById('undoBtn'); if(!u) return {err:'no #undoBtn'}; u.click(); const r2=__qa.rows()[${i}]; return {st:__qa.val(r2,'start'), hrs:__qa.num(__qa.val(r2,'hrs'))}; })()`);
      assert(!r.err, r.err);
      assert(preStart, 'start-month step did not run');
      assert(r.st === preStart.st, `after undo start ${r.st}, expected ${preStart.st}`);
      assert(near(r.hrs, preStart.hrs, 0.051), `after undo hr/yr ${r.hrs}, expected ${preStart.hrs} (undo went back more than one step?)`);
      return `${r.st}, ${r.hrs} hr/yr`;
    });

    await check(`${tag}: budgets are editable and move headroom`, async () => {
      const r = await ev(`(()=>{ const code=__qa.val(__qa.rows()[${i}],'code'); const a=document.querySelector('[data-auth="'+code+'"]'); if(!a) return {err:'no [data-auth="'+code+'"]'};
        const h0=__qa.head(code), a0=__qa.num(a.value ?? a.textContent); __qa.set(a, String(a0+1000)); const a1=document.querySelector('[data-auth="'+code+'"]');
        return {code, a0, a1:__qa.num(a1.value ?? a1.textContent), h0, h1:__qa.head(code), st:__qa.state()}; })()`);
      assert(!r.err, r.err);
      assert(near(r.a1, r.a0 + 1000), `SC-${r.code} budget ${r.a0} → ${r.a1}`);
      if (!Number.isNaN(r.h0)) assert(near(r.h1 - r.h0, 1000, 0.01), `headroom moved ${r.h0} → ${r.h1}`);
      if (r.st) { const a = r.st.auth?.[r.code]; assert(near(typeof a === 'object' ? a.auth : a, r.a0 + 1000), `state().auth[${r.code}] = ${JSON.stringify(a)}`); }
      await ev(`__qa.set(document.querySelector('[data-auth="${r.code}"]'), String(${r.a0}))`);
      return `SC-${r.code} ${r.a0} → ${r.a1}, headroom ${r.h0} → ${r.h1}`;
    });

    await check(`${tag}: scenario save → reset → load round-trips`, async () => {
      const r = await ev(`(()=>{ const need=['scnName','scnSave','scnSel','resetBtn'].filter(x=>!document.getElementById(x)); if(need.length) return {err:'missing #'+need.join(', #')};
        const snap=()=>__qa.rows().map(r=>[__qa.val(r,'provider'),__qa.val(r,'code'),__qa.val(r,'start')].concat(['wk','hrs','dol'].map(k=>__qa.num(__qa.val(r,k)).toFixed(2))).join('|')).join('\\n');
        __qa.set(${R0}.querySelector('[data-k="wk"]'),'3');
        const saved=snap(); document.getElementById('scnName').value='qa-A'; document.getElementById('scnName').dispatchEvent(new Event('input',{bubbles:true}));
        document.getElementById('scnSave').click(); const opts=[...document.getElementById('scnSel').options].map(o=>o.value);
        document.getElementById('resetBtn').click(); const reset=snap();
        const s=document.getElementById('scnSel'); s.value='qa-A'; s.dispatchEvent(new Event('change',{bubbles:true}));
        return {opts, changedOnReset: reset!==saved, same: snap()===saved}; })()`);
      assert(!r.err, r.err);
      assert(r.opts.includes('qa-A'), `#scnSel options ${JSON.stringify(r.opts)}`);
      assert(r.changedOnReset, 'reset did not change the proposal (cannot tell if load worked)');
      assert(r.same, 'loaded scenario differs from what was saved');
    });
  }

  await check('demo mode loads', async () => {
    const r = await ev(`(()=>{ const b=document.getElementById('demoBtn'); if(b){ b.click(); return 'clicked #demoBtn'; } return 'no #demoBtn (demo assumed default)'; })()`);
    assert(await cdp.waitFor(`__qa.rows().length>0`, 3000), 'no rows after demo'); return r;
  });
  await calculatorChecks('demo');

  // Load the fixtures the way a user does: through the file input.
  await check('fixtures load through the file input', async () => {
    const doc = await cdp.send('DOM.getDocument', { depth: -1 });
    const q = await cdp.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'input[type=file]' });
    assert(q.nodeId, 'no input[type=file]');
    await ev(`document.querySelectorAll('#calcBody tr').forEach(r=>r.dataset.qaOld='1')`);
    await cdp.send('DOM.setFileInputFiles', { nodeId: q.nodeId, files: [join(fixtures, 'ace-plan.xlsx'), join(fixtures, 'ace-report.xlsx')] });
    // Some pages confirm the detected files before opening them (#openBtn); click it once it is enabled.
    await cdp.waitFor(`(()=>{ const b=document.getElementById('openBtn'); if(!b) return true; if(b.disabled) return false; b.click(); return true; })()`, 5000);
    const ok = await cdp.waitFor(`__qa.rows().length>0 && !__qa.rows().some(r=>r.dataset.qaOld)`, 5000);
    assert(ok, 'calculator did not re-render after file input change');
    const st = await ev(`__qa.state()`);
    if (st?.auth) for (const [c, a] of Object.entries(expected.plan.codes)) { const v = st.auth[c]; assert(near(typeof v === 'object' ? v?.auth : v, a), `state auth SC-${c} ${JSON.stringify(v)} ≠ ${a}`); }
    const provs = await ev(`__qa.rows().map(r=>__qa.val(r,'provider'))`);
    assert(provs.some(p => /Sam Jordan|Casey Park|Morgan Lee/.test(p || '')), `fixture providers not in rows: ${JSON.stringify(provs)}`);
    return `${provs.length} rows`;
  });
  await calculatorChecks('fixtures');

  await check('reload keeps state (localStorage) without errors', async () => {
    await cdp.navigate(url); await ev(QA);
    assert(await cdp.waitFor(`__qa.rows().length>0`, 3000), 'no rows after reload');
  });
  await check('zero Runtime.exceptionThrown', () => assert(cdp.errors.length === 0, cdp.errors.join(' | ')));
  await check('zero console errors / failed loads', () => {
    const real = cdp.logs.filter(l => !/fonts\.(googleapis|gstatic)\.com|favicon/.test(l)); // offline fonts are allowed to fail
    assert(real.length === 0, real.join(' | '));
  });
  exitCode = T.summary().fail ? 1 : 0;
} catch (e) {
  console.error('SMOKE ABORTED', e); T.summary();
} finally {
  await cdp.close();
}
process.exit(exitCode);
