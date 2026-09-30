// Parses lucid-qa's on-disk synthetic ACE fixtures (tests/fixtures/*.xlsx) and compares with expected.json.
// Guards the real .xlsx byte round-trip that the in-memory workbooks in ace-workbooks.js do not.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const XLSX = require('../../vendor/xlsx.full.min.js');
const parsers = require('../../parsers/index.js');

const DIR = process.env.SDP_FIXTURES || path.join(__dirname, '..', 'fixtures');
const have = ['ace-plan.xlsx', 'ace-report.xlsx', 'expected.json'].every(f => fs.existsSync(path.join(DIR, f)));
const read = f => parsers.parse(XLSX.read(fs.readFileSync(path.join(DIR, f)), { type: 'buffer' }));
const E = have ? JSON.parse(fs.readFileSync(path.join(DIR, 'expected.json'), 'utf8')) : null;

test('fixture plan matches expected.json', { skip: !have && 'tests/fixtures not present' }, () => {
  const { kind, data: p } = read('ace-plan.xlsx');
  assert.equal(kind, 'ace-plan');
  assert.deepEqual(p.planYear, E.plan.planYear);
  assert.deepEqual(p.participant, E.plan.participant);
  for (const k of Object.keys(E.plan.fms)) if (k !== 'name') assert.equal(p.fms[k], E.plan.fms[k], 'fms.' + k); // no FMS-name cell in ACE plans
  assert.deepEqual(Object.fromEntries(Object.entries(p.codes).map(([c, v]) => [c, v.auth])), E.plan.codes);
  assert.equal(p.total, E.plan.total);
  assert.equal(p.lines.length, E.plan.lineCount);
  // Compare exactly the fields expected.json lists. Older fixtures named the raw TYPE OF UNITS cell `unit`;
  // the parser (and current fixtures) call it `unitType` — accept either spelling.
  const pick = (L, e) => Object.fromEntries(Object.keys(e).map(k => [k, k === 'unit' ? L.unitType : L[k]]));
  assert.deepEqual(p.lines.map((L, i) => pick(L, E.plan.lines[i] || {})), E.plan.lines);
});

test('fixture report matches expected.json and self-reconciles', { skip: !have && 'tests/fixtures not present' }, () => {
  const { kind, data: r } = read('ace-report.xlsx');
  assert.equal(kind, 'ace-report');
  assert.equal(r.checks.ok, true, JSON.stringify(r.checks.mismatches));
  assert.equal(r.rows.length, E.report.rowCount);
  assert.equal(r.rows.map(x => x.date).sort((a, b) => (a.slice(6) + a).localeCompare(b.slice(6) + b)).at(-1), E.report.latestServiceDate);
  assert.equal(r.rows.reduce((s, x) => s + x.spent, 0), E.report.spentTotal);
  for (const [c, b] of Object.entries(E.report.byCode))
    assert.deepEqual({ spent: r.byCode[c].spent, alloc: r.byCode[c].alloc, available: r.byCode[c].available }, b, c);
  assert.deepEqual(r.byProvider, E.report.byProvider);
  const sw = E.report.swappedInvoice;
  assert.deepEqual(r.rows.filter(x => x.invoice === sw.invoice).map(x => ({ code: x.code, spent: x.spent })), sw.lines,
    'a split invoice stays under each line\'s booked code');
});
