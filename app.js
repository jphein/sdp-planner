/* sdp-planner — UI. Classic script (no modules) so it runs from file:// and GitHub Pages.
 * Consumes window.SDP (model.js, parsers/*, demo/demo-data.js — see docs/SPEC.md "Shared interface").
 * No network calls. Everything the user enters stays in localStorage. */
(function () {
  'use strict';

  var SDP = window.SDP || {}, M = SDP.model;
  var missing = ['model', 'parsers', 'demo'].filter(function (k) { return !SDP[k]; });
  if (missing.length) { // a file failed to load (e.g. a partial copy): say so instead of a blank page
    var ob = document.getElementById('obStatus');
    if (ob) ob.textContent = 'Some app files did not load (' + missing.join(', ') + '). Keep index.html next to model.js, parsers/, demo/ and vendor/.';
    ['demoBtn', 'openBtn'].forEach(function (id) { var b = document.getElementById(id); if (b) b.disabled = true; });
    return;
  }


  /* ------------------------------------------------------------------ helpers */
  var $ = function (id) { return document.getElementById(id); };
  function esc(x) { return String(x == null ? '' : x).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function money(x) { return (+x || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function fmt(x) { return (x < -0.005 ? '−$' : '$') + money(Math.abs(x)); }
  function fmt0(x) { return (x < -0.5 ? '−$' : '$') + Math.abs(Math.round(x)).toLocaleString('en-US'); }
  function signed(x) { return (x < -0.005 ? '−$' : '+$') + money(Math.abs(x)); }
  function num(v) { return Math.max(0, parseFloat(String(v).replace(/[^0-9.]/g, '')) || 0); }
  function mdy(iso) { var p = String(iso).split('-'); return p.length === 3 ? p[1] + '/' + p[2] + '/' + p[0] : String(iso); }
  function ymOfRow(d) { // 'MM/DD/YYYY' (spec) or ISO fallback -> 'YYYY-MM'
    var s = String(d); var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); if (m) return m[3] + '-' + (m[1].length < 2 ? '0' : '') + m[1];
    m = s.match(/^(\d{4})-(\d{2})/); return m ? m[1] + '-' + m[2] : '';
  }
  function rowSortKey(d) { var ym = ymOfRow(d), m = String(d).match(/^\d{1,2}\/(\d{1,2})/); return ym + '-' + (m ? ('0' + m[1]).slice(-2) : '00'); }
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function ml(ym) { var p = ym.split('-'); return MON[+p[1] - 1] + "’" + p[0].slice(2); }
  function monthsBetween(startYm, endYm) { var out = [], p = startYm.split('-'), y = +p[0], m = +p[1], e = endYm.split('-'), guard = 0; while ((y < +e[0] || (y === +e[0] && m <= +e[1])) && guard++ < 36) { out.push(y + '-' + ('0' + m).slice(-2)); m++; if (m > 12) { m = 1; y++; } } return out; }
  function store(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function fetchKey(k) { try { var s = localStorage.getItem(k); return s ? JSON.parse(s) : null; } catch (e) { return null; } }

  /* ------------------------------------------------------------------ state */
  var KEY = 'sdp-planner:v1', SKEY = 'sdp-planner:scenarios';
  var X = null;            // derived context for the loaded dataset
  var lines = [], auth = {}, hist = [], lastVerdict = null, refocusing = false;

  function emptyReport(plan) { return { asOf: plan.planYear.start, rows: [], byCode: {}, byProvider: {} }; }

  function context(ds) {
    var plan = ds.plan, report = ds.report || emptyReport(plan);
    var codes = Object.keys(plan.codes).map(String).sort();
    var startYm = plan.planYear.start.slice(0, 7), endYm = plan.planYear.end.slice(0, 7);
    var months = monthsBetween(startYm, endYm);
    var q = null; try { q = new URLSearchParams(location.search).get('today'); } catch (e) { }
    var today = q ? new Date(q + 'T12:00:00') : new Date();
    var ys = new Date(plan.planYear.start + 'T00:00:00'), ye = new Date(plan.planYear.end + 'T23:59:59');
    if (today < ys) today = ys; if (today > ye) today = ye;
    var weeksLeft = Math.max(1, ((ye - today) / 864e5) / 7);
    var pc = M.pace(report, plan, report.asOf) || {};
    var monthsElapsed = pc.monthsElapsed != null ? pc.monthsElapsed : 0;
    var billed = {}, byMonth = {}, committedBy = {};
    codes.forEach(function (c) { committedBy[c] = 0; });
    (report.rows || []).forEach(function (r) {
      var amt = (+r.spent || 0) + (+r.alloc || 0), c = String(r.code);
      billed[r.provider + '|' + c] = (billed[r.provider + '|' + c] || 0) + amt;
      committedBy[c] = (committedBy[c] || 0) + amt;
    });
    if (report.byCode) codes.forEach(function (c) { var b = report.byCode[c]; if (b) committedBy[c] = (+b.spent || 0) + (+b.alloc || 0); });
    var committed = 0; codes.forEach(function (c) { committed += committedBy[c] || 0; });
    var defaults = M.buildProposal(plan, ds.report || null) || [];
    defaults.forEach(function (L, i) { L.code = String(L.code); if (!L.id) L.id = 'd' + i; if (!L.start) L.start = startYm; });
    var auth0 = {}; codes.forEach(function (c) { auth0[c] = +plan.codes[c].auth || 0; });
    var rateBySvc = {}; defaults.forEach(function (L) { if (!L.fixed && L.service && !(L.service in rateBySvc)) rateBySvc[L.service] = L.rate; });
    var lastPost = ''; (report.rows || []).forEach(function (r) { var k = rowSortKey(r.date); if (k > lastPost) lastPost = k; });
    return { ds: ds, plan: plan, report: report, codes: codes, codeIdx: codes.reduce(function (o, c, i) { o[c] = i; return o; }, {}),
      months: months, startYm: startYm, yearEnd: plan.planYear.end, today: today, weeksLeft: weeksLeft, pace: pc, monthsElapsed: monthsElapsed,
      billed: billed, committedBy: committedBy, committed: committed, defaults: defaults,
      defById: defaults.reduce(function (o, L) { o[L.id] = L; return o; }, {}), auth0: auth0, rateBySvc: rateBySvc };
  }

  function normalize(ls) {
    ls.forEach(function (L, i) {
      L.code = String(L.code); if (!L.id) L.id = 'l' + Date.now() + i;
      if (!L.start || X.months.indexOf(L.start) < 0) L.start = X.startYm;
      if (L.fixed) L.hours = 1;
      L.rate = +L.rate || 0; L.hours = +L.hours || 0;
    });
    return ls;
  }
  function yr(L) { return L.fixed ? L.rate : L.hours * L.rate; }
  function weeksFrom(ym) { return M.weeksFrom(ym, X.yearEnd); }
  function monthsFrom(ym) { return M.monthsFrom(ym, X.yearEnd); }
  function codeTag(c) { return '<span class="code k' + ((X.codeIdx[c] != null ? X.codeIdx[c] : 5) % 6) + '">' + esc(c) + '</span>'; }
  function codeName(c) { var o = X.plan.codes[c]; return o && o.name ? o.name : 'Service code ' + c; }

  function save() {
    var ok = store(KEY, { app: 'sdp-planner', v: 1, saved: new Date().toISOString(), dataset: X.ds, lines: lines, auth: auth });
    $('saveStatus').textContent = ok ? 'saved in this browser · ' + new Date().toLocaleTimeString() : 'browser storage unavailable — use Export';
  }
  function snap() { hist.push(JSON.stringify({ lines: lines, auth: auth })); if (hist.length > 40) hist.shift(); $('undoBtn').disabled = false; }
  function undo() { if (!hist.length) return; var o = JSON.parse(hist.pop()); lines = normalize(o.lines); auth = o.auth; render(); save(); $('undoBtn').disabled = !hist.length; $('saveStatus').textContent = 'undone'; }

  /* ------------------------------------------------------------------ onboarding */
  var pending = {}; // 'plan' | 'report' -> {data, name, kind}
  function roleOf(kind) { return /-plan$/.test(kind || '') ? 'plan' : /-report$/.test(kind || '') ? 'report' : null; }
  function kindLabel(kind) {
    var id = String(kind).replace(/-(plan|report)$/, ''), fms = id.toUpperCase();
    try { (SDP.parsers.list ? SDP.parsers.list() : []).forEach(function (m) { if (m.id === id && m.label) fms = m.label; }); } catch (e) { }
    return roleOf(kind) === 'plan' ? 'Spending plan · ' + fms : 'Year-to-date report · ' + fms;
  }

  function showOnboard(show) {
    $('onboard').hidden = !show; $('app').hidden = show;
    $('backBtn').hidden = !(show && X);
  }
  function foundItem(name, kind, ok, msg) {
    var li = document.createElement('li'); li.className = ok ? 'okk' : 'nok';
    li.innerHTML = '<span class="f">' + esc(name) + '</span><span class="k">' + esc(msg || (ok ? '✓ ' + kindLabel(kind) : '✕ not recognised')) + '</span>';
    $('found').appendChild(li);
  }
  function updateOpen() {
    $('openBtn').disabled = !pending.plan;
    $('obStatus').textContent = pending.plan ? (pending.report ? 'Ready.' : 'Plan found. Add the FMS report for actuals, or open the plan now.') : (pending.report ? 'Report found — add the spending plan too.' : '');
  }
  function handleFiles(list) {
    Array.prototype.forEach.call(list || [], function (f) {
      if (/\.json$/i.test(f.name)) { importJSONFile(f); return; }
      if (!window.XLSX) { foundItem(f.name, null, false, '✕ spreadsheet reader missing (vendor/xlsx.full.min.js)'); return; }
      var r = new FileReader();
      r.onload = function () {
        try {
          var res = SDP.parsers.fromArrayBuffer ? SDP.parsers.fromArrayBuffer(r.result)
            : SDP.parsers.parse(window.XLSX.read(new Uint8Array(r.result), { type: 'array' }));
          var kind = res && res.kind;
          if (!res || !res.data) throw new Error('empty parse');
          var kk = res.kind || kind, role = roleOf(kk);
          if (!role) { foundItem(f.name, null, false); return; }
          pending[role] = { data: res.data, name: f.name, kind: kk };
          foundItem(f.name, kk, true);
        } catch (err) { var em = String(err && err.message || err); foundItem(f.name, null, false, /Unrecognized/i.test(em) ? '✕ not a spending plan or FMS report this app can read' : '✕ could not read: ' + em.slice(0, 80)); }
        updateOpen();
      };
      r.onerror = function () { foundItem(f.name, null, false, '✕ could not open'); };
      r.readAsArrayBuffer(f);
    });
  }
  function start(ds, fresh, state) {
    X = context(ds);
    if (fresh || !state) { lines = normalize(clone(X.defaults)); auth = clone(X.auth0); }
    else { lines = normalize(state.lines); auth = state.auth || clone(X.auth0); X.codes.forEach(function (c) { if (auth[c] == null) auth[c] = X.auth0[c]; }); }
    hist = []; $('undoBtn').disabled = true; lastVerdict = null;
    masthead(); staticTables(); render(); showOnboard(false);
    if (fresh) save();
  }

  /* ------------------------------------------------------------------ masthead + static tables */
  function masthead() {
    var p = X.plan, k = [];
    if (X.ds.source === 'demo') k.push('<b>Demo</b> · made-up data');
    if (p.participant && p.participant.name) k.push('<b>' + esc(p.participant.name) + '</b>');
    if (p.fms && p.fms.name) k.push(esc(p.fms.name) + (p.fms.model ? ' · ' + esc(p.fms.model) : ''));
    k.push('Plan year ' + esc(p.planYear.start.slice(0, 4)) + '–' + esc(p.planYear.end.slice(2, 4)));
    $('kicker').innerHTML = k.map(function (x) { return '<span>' + x + '</span>'; }).join('');
    $('ghost').textContent = p.planYear.start.slice(2, 4) + '–' + p.planYear.end.slice(2, 4);
    var lp = X.report.rows && X.report.rows.length ? X.report.rows.reduce(function (a, r) { return rowSortKey(r.date) > rowSortKey(a) ? r.date : a; }, X.report.rows[0].date) : null;
    $('meta').innerHTML = 'Plan year <b>' + esc(mdy(p.planYear.start)) + ' – ' + esc(mdy(p.planYear.end)) + '</b>'
      + (p.coordinator ? ' · Service coordinator ' + esc(p.coordinator) : '')
      + (lp ? ' · Report as of <b>' + esc(mdy(X.report.asOf)) + '</b>, latest service date <b>' + esc(lp) + '</b>' : ' · <b>No FMS report loaded</b> — actuals show as $0')
      + ' · ' + X.weeksLeft.toFixed(1) + ' weeks left';
    var ye = mdy(X.yearEnd); $('yearEndA').textContent = ye; $('yearEndB').textContent = ye;
    var files = X.ds.files && X.ds.files.length ? 'Source files: <b>' + X.ds.files.map(esc).join('</b>, <b>') + '</b> · ' : (X.ds.source === 'demo' ? 'Showing the <b>demo</b> dataset (made-up people and amounts) · ' : '');
    $('srcLine').innerHTML = files + 'Budget is authorized by service code; money never moves between codes; an unspent balance is forfeited at plan-year end.';
  }

  function staticTables() {
    // § 02 pace
    var pc = X.pace, n = X.monthsElapsed, frac = n / Math.max(1, X.months.length), cb = $('codeBody'), tot = { a: 0, c: 0 };
    $('paceIntro').innerHTML = 'The red tick is where even spending would sit after <b>' + n + '</b> of ' + X.months.length + ' service months. Under pace early is usually <b>billing lag, not savings</b>: rows post about a month after the service. Over pace is the one to watch.';
    cb.innerHTML = '';
    X.codes.forEach(function (c) {
      var a = X.auth0[c], com = X.committedBy[c] || 0, pr = (pc.byCode && pc.byCode[c]) || {};
      var exp = pr.expected != null ? pr.expected : a * frac, diff = pr.diff != null ? pr.diff : com - exp, pct = a ? com / a * 100 : 0;
      tot.a += a; tot.c += com;
      var tr = document.createElement('tr');
      tr.innerHTML = '<th scope="row">' + codeTag(c) + '</th><td>' + esc(codeName(c)) + '</td><td class="num">' + fmt(a) + '</td><td class="num">' + fmt(com) + '</td><td class="num">' + fmt(a - com) + '</td><td class="num">' + pct.toFixed(1) + '%</td><td class="num ' + (diff > 0.5 ? 'over' : 'under') + '">' + signed(diff) + '</td>'
        + '<td><div class="pace" role="img" aria-label="' + pct.toFixed(0) + '% used; even pace is ' + (frac * 100).toFixed(0) + '%"><b style="width:' + Math.min(100, pct) + '%"></b><i style="left:' + (frac * 100) + '%"></i></div></td>';
      cb.appendChild(tr);
    });
    var tr = document.createElement('tr'); tr.className = 'total';
    tr.innerHTML = '<th scope="row" colspan="2">Total</th><td class="num">' + fmt(tot.a) + '</td><td class="num">' + fmt(tot.c) + '</td><td class="num">' + fmt(tot.a - tot.c) + '</td><td class="num">' + (tot.a ? tot.c / tot.a * 100 : 0).toFixed(1) + '%</td><td></td><td></td>';
    cb.appendChild(tr);

    // § 03 provider × month
    var rows = X.report.rows || [], pm = {}, used = {};
    rows.forEach(function (r) { var m = ymOfRow(r.date); pm[r.provider] = pm[r.provider] || {}; pm[r.provider][m] = (pm[r.provider][m] || 0) + (+r.spent || 0) + (+r.alloc || 0); used[m] = 1; });
    var cols = X.months.filter(function (m) { return used[m]; }); if (!cols.length) cols = X.months.slice(0, Math.max(1, X.monthsElapsed));
    $('pmHead').innerHTML = '<tr><th scope="col">Provider</th>' + cols.map(function (m) { return '<th scope="col" class="num">' + ml(m) + '</th>'; }).join('') + '<th scope="col" class="num">Total</th></tr>';
    var pb = $('pmBody'); pb.innerHTML = '';
    var provs = Object.keys(pm).map(function (p) { var t = 0; for (var k in pm[p]) t += pm[p][k]; return [p, t]; }).sort(function (a, b) { return b[1] - a[1]; });
    if (!provs.length) pb.innerHTML = '<tr><td class="empty" colspan="' + (cols.length + 2) + '">No postings yet.</td></tr>';
    provs.forEach(function (pt) {
      var p = pt[0], tr = document.createElement('tr');
      tr.innerHTML = '<th scope="row">' + esc(p) + '</th>' + cols.map(function (m) { var v = pm[p][m] || 0; return '<td class="num">' + (v ? fmt(v) : '<span class="dim" aria-label="none">·</span>') + '</td>'; }).join('') + '<td class="num"><b>' + fmt(pt[1]) + '</b></td>';
      pb.appendChild(tr);
    });

    // § 04 plan lines
    var plb = $('planBody'); plb.innerHTML = '';
    (X.plan.lines || []).forEach(function (l) {
      var tr = document.createElement('tr');
      tr.innerHTML = '<td>' + codeTag(String(l.code)) + '</td><th scope="row">' + esc(l.description) + '</th><td class="dim">' + esc((l.providers || []).join(', ')) + '</td><td class="num">' + esc(l.unitsPerYear) + ' ' + esc(l.unit || '') + '</td><td class="num">' + fmt(+l.rate || 0) + '</td><td class="num">' + fmt(+l.yearly || 0) + '</td>';
      plb.appendChild(tr);
    });
    var ptot = X.plan.total != null ? +X.plan.total : (X.plan.lines || []).reduce(function (s, l) { return s + (+l.yearly || 0); }, 0);
    var tr2 = document.createElement('tr'); tr2.className = 'total';
    tr2.innerHTML = '<th scope="row" colspan="5">Spending plan total</th><td class="num">' + fmt(ptot) + '</td>';
    plb.appendChild(tr2);

    // § 05 invoices
    var ib = $('invBody'); ib.innerHTML = '';
    if (!rows.length) ib.innerHTML = '<tr><td class="empty" colspan="6">No invoices yet — load the FMS year-to-date report to see them.</td></tr>';
    rows.slice().sort(function (a, b) { return rowSortKey(b.date).localeCompare(rowSortKey(a.date)); }).forEach(function (r) {
      var tr = document.createElement('tr'), paid = (+r.spent || 0) > 0;
      tr.innerHTML = '<td class="mono">' + esc(r.date) + '</td><th scope="row">' + esc(r.provider) + '</th><td>' + codeTag(String(r.code)) + '</td><td class="dim">' + esc(String(r.description || '').slice(0, 90)) + '</td><td class="num">' + fmt((+r.spent || 0) + (+r.alloc || 0)) + '</td><td>' + (paid ? '<span class="chip">paid</span>' : '<span class="pend">pending</span>') + '</td>';
      ib.appendChild(tr);
    });
  }

  /* ------------------------------------------------------------------ proposal table */
  function billedFor(L) {
    if (M.billed) return M.billed(X.report, L.provider, L.code);
    var k = L.provider + '|' + L.code; if (X.billed[k] != null) return X.billed[k];
    var b = 0, name = String(L.provider || '');
    if (!name) return 0;
    Object.keys(X.billed).forEach(function (key) { var i = key.lastIndexOf('|'), p = key.slice(0, i), c = key.slice(i + 1); if (c === L.code && (p.indexOf(name) === 0 || name.indexOf(p) === 0)) b += X.billed[key]; });
    return b;
  }
  function chip(L, b) {
    if (!b) return '<span class="chip none">—<span class="sr-only"> nothing billed</span></span>';
    var mo = monthsFrom(L.start), idx = X.months.indexOf(L.start);
    var exp = yr(L) / mo * Math.max(0, Math.min(mo, X.monthsElapsed - idx)), ahead = !L.fixed && b > exp * 1.05 + 0.5;
    var t = L.fixed ? 'prepaid / fixed line' : (ahead ? 'ahead of this proposal: ' : 'on or under pace: ') + fmt(exp) + ' expected so far';
    return '<span class="chip' + (ahead ? ' ahead' : '') + '" title="' + esc(t) + '">' + fmt(b) + '<span class="sr-only"> (' + esc(t) + ')</span></span>';
  }
  function services() {
    var s = {}; Object.keys(X.rateBySvc).forEach(function (k) { s[k] = 1; }); lines.forEach(function (L) { if (!L.fixed && L.service) s[L.service] = 1; });
    return Object.keys(s).sort().concat(['fixed']);
  }
  function sel(i, k, val, opts, cls, label) {
    return '<select class="w' + (cls ? ' ' + cls : '') + '" data-i="' + i + '" data-k="' + k + '" aria-label="' + esc(label) + '">' + opts.map(function (o) {
      var lab = k === 'c' ? 'SC-' + o : k === 'st' ? ml(o) : o;
      return '<option value="' + esc(o) + '"' + (String(val) === String(o) ? ' selected' : '') + '>' + esc(lab) + '</option>';
    }).join('') + '</select>';
  }

  function render() {
    var tb = $('calcBody'); tb.innerHTML = '';
    var svcs = services();
    lines.forEach(function (L, i) {
      var tr = document.createElement('tr'), dol = yr(L), isNew = !X.defById[L.id], wk = weeksFrom(L.start), mo = monthsFrom(L.start);
      var who = L.provider ? '“' + L.provider + '”' : 'line ' + (i + 1);
      var nameCell = '<input class="w t" data-i="' + i + '" data-k="t" value="' + esc(L.provider) + '" title="' + esc(L.provider) + '" aria-label="Provider name, line ' + (i + 1) + '">'
        + (isNew ? '<span class="tag">proposed</span>' : '')
        + (L.note ? '<span class="info" tabindex="0" role="img" title="' + esc(L.note) + '" aria-label="Note: ' + esc(L.note) + '">i</span>' : '');
      var codeCell = sel(i, 'c', L.code, X.codes.indexOf(L.code) < 0 ? X.codes.concat([L.code]) : X.codes, '', 'Service code for ' + who);
      var svcCell = sel(i, 'svc', L.fixed ? 'fixed' : L.service, svcs.indexOf(L.service) < 0 && !L.fixed ? [L.service].concat(svcs) : svcs, '', 'Service type for ' + who);
      var def = X.defById[L.id];
      var pl = L.planLine != null && X.plan.lines ? X.plan.lines[L.planLine] : null, perTime = !!(pl && /^(week|wk|day)/i.test(pl.unit || ''));
      var rateCell = L.fixed && perTime ? '<div class="pair"><input class="w r" type="number" step="0.01" min="0" data-i="' + i + '" data-k="convrate" placeholder="$/hr" title="This plan line is budgeted per ' + esc(pl.unit) + ', not per hour. Enter the hourly rate from your plan to plan it in hours." aria-label="Hourly rate for ' + esc(who) + ' (converts this per-' + esc(pl.unit) + ' line to hours)"><span class="u" aria-hidden="true">/hr</span></div>'
        : L.fixed ? '<span class="dim mono" title="approved plan amount for this line">' + (def && def.fixed ? 'plan ' + fmt(def.rate) : '—') + '</span>'
        : '<div class="pair"><input class="w r" type="number" step="0.01" min="0" data-i="' + i + '" data-k="rate" value="' + (+L.rate).toFixed(2) + '" aria-label="Hourly rate for ' + esc(who) + '"><span class="u" aria-hidden="true">/hr</span></div>';
      var dash = '<span class="dim mono" aria-label="not applicable">—</span>';
      var wkCell = L.fixed ? dash : '<input class="w h" type="number" step="0.25" min="0" data-i="' + i + '" data-k="wk" value="' + (L.hours / wk).toFixed(2) + '" title="over ' + wk.toFixed(1) + ' weeks from ' + ml(L.start) + '" aria-label="Hours per week for ' + esc(who) + '">';
      var moCell = L.fixed ? dash : '<input class="w h" type="number" step="0.5" min="0" data-i="' + i + '" data-k="mo" value="' + (L.hours / mo).toFixed(1) + '" title="over ' + mo + ' months from ' + ml(L.start) + '" aria-label="Hours per month for ' + esc(who) + '">';
      var hrsCell = L.fixed ? dash : '<input class="w h" type="number" step="0.5" min="0" data-i="' + i + '" data-k="hrs" value="' + (+L.hours).toFixed(1) + '" aria-label="Hours per year for ' + esc(who) + '">';
      var dolCell = '<input class="w d" type="text" inputmode="decimal" data-i="' + i + '" data-k="dol" value="' + money(dol) + '" aria-label="Dollars per year for ' + esc(who) + '">';
      tr.innerHTML = '<td class="name">' + nameCell + '</td><td>' + codeCell + '</td><td>' + svcCell + '</td><td class="num">' + rateCell + '</td><td class="num">' + chip(L, billedFor(L)) + '</td><td>'
        + sel(i, 'st', L.start, X.months, 'st', 'Start month for ' + who) + '</td><td class="num">' + wkCell + '</td><td class="num">' + moCell + '</td><td class="num">' + hrsCell + '</td><td class="num">' + dolCell + '</td><td class="num dim" data-mo="' + i + '">' + fmt(dol / mo) + '</td>'
        + '<td style="white-space:nowrap"><button class="btn fill" data-fill="' + i + '" type="button" title="Fill: set this line so its code ends at $0" aria-label="Fill ' + esc(who) + ' to what is left in SC-' + esc(L.code) + '">⤓</button> '
        + '<button class="btn x" data-del="' + i + '" type="button" title="Remove this line" aria-label="Remove ' + esc(who) + '">✕</button></td>';
      tb.appendChild(tr);
    });
    if (!lines.length) tb.innerHTML = '<tr><td class="empty" colspan="12">No lines. Use “Add a line” or “Reset to plan”.</td></tr>';
    renderBudgets();
    rollup();
  }

  function renderBudgets() {
    var b = $('budgets');
    b.innerHTML = '<div class="ttl"><h3 id="budH">Budgets by code</h3><span class="dim">edit if the plan is amended · the approved figure is shown underneath · <b>' + X.weeksLeft.toFixed(1) + ' weeks</b> left in the plan year from today</span></div><div class="strip-row">'
      + X.codes.map(function (c) {
        return '<div><div style="margin-bottom:4px">' + codeTag(c) + '</div><input class="w d" type="text" inputmode="decimal" data-auth="' + esc(c) + '" value="' + money(auth[c]) + '" style="width:120px" aria-label="Budget for SC-' + esc(c) + ', ' + esc(codeName(c)) + '" aria-describedby="ref' + esc(c) + '"><div class="ref" id="ref' + esc(c) + '"></div></div>';
      }).join('')
      + '<div class="tot"><div class="l">total</div><div class="v" id="authTot"></div></div></div>';
    refreshBudgetRefs();
  }
  function refreshBudgetRefs() {
    var t = 0;
    X.codes.forEach(function (c) { t += +auth[c] || 0; var el = $('ref' + c); if (el) el.textContent = Math.abs(auth[c] - X.auth0[c]) > 0.005 ? 'plan ' + fmt(X.auth0[c]) : '= plan'; });
    $('authTot').textContent = fmt(t);
  }

  function potRate(c) { // rate a new person would bill in this code: the biggest hourly line's rate
    var best = null; lines.forEach(function (L) { if (L.code === c && !L.fixed && L.rate > 0 && (!best || L.hours > best.hours)) best = L; });
    return best ? best.rate : 0;
  }

  var liveT = null;
  function rollup() {
    var F = M.forecast(lines, auth) || {}, by = F.byCode || {}, planTotal = 0, totalFc = 0, worstOver = 0;
    function head(c) { var o = by[c]; return o ? o.headroom : (auth[c] || 0); }
    function prop(c) { var o = by[c]; return o ? o.proposal : 0; }
    X.codes.forEach(function (c) { planTotal += +auth[c] || 0; totalFc += prop(c); if (head(c) < -0.005) worstOver += -head(c); });
    var overCodes = X.codes.filter(function (c) { return head(c) < -0.005; }), fits = !overCodes.length;
    var remMonths = Math.max(1, X.months.length - X.monthsElapsed);

    // pots
    var res = $('results'); res.innerHTML = '';
    X.codes.forEach(function (c) {
      var a = +auth[c] || 0, h = head(c), rate = potRate(c), over = h < -0.005;
      var pot = document.createElement('div'); pot.className = 'pot';
      pot.innerHTML = '<div class="ttl">' + codeTag(c) + '<h3>' + esc(codeName(c)) + '</h3></div>'
        + '<div class="e"><span class="k">Budget</span><span class="v">' + fmt(a) + '</span></div>'
        + '<div class="e"><span class="k">Proposal total</span><span class="v">' + fmt(prop(c)) + '</span></div>'
        + '<div class="e"><span class="k">Billed so far</span><span class="v">' + fmt(X.committedBy[c] || 0) + '</span></div>'
        + '<div class="e head' + (over ? ' over' : '') + '"><span class="k">' + (over ? 'Over budget' : 'Headroom') + '</span><span class="v" data-head="' + esc(c) + '">' + fmt(h) + '</span></div>'
        + (rate ? '<div class="hrs">= ' + (h / rate).toFixed(1) + ' hr · <b>' + (h / rate / X.weeksLeft).toFixed(1) + ' hr/wk</b> from today at $' + rate.toFixed(2) + ' · ' + (h / rate / remMonths).toFixed(1) + ' hr/mo</div>' : '<div class="hrs">no hourly line in this code</div>')
        + '<div class="bar' + (over ? ' over' : '') + '" role="img" aria-label="Proposal uses ' + (a ? prop(c) / a * 100 : 0).toFixed(0) + '% of the SC-' + esc(c) + ' budget"><b style="width:' + Math.min(100, a ? prop(c) / a * 100 : 0) + '%"></b><i style="left:' + (X.monthsElapsed / X.months.length * 100) + '%"></i></div>';
      res.appendChild(pot);
    });

    // hero figs: codes that have an hourly line
    var figCodes = X.codes.filter(function (c) { return potRate(c) > 0; }).slice(0, 4);
    $('figs').innerHTML = figCodes.map(function (c) {
      var h = head(c), rate = potRate(c), o = h < -0.005, per = Math.abs(h / rate / X.weeksLeft).toFixed(1);
      return '<div class="fig' + (o ? ' over' : '') + '"><div class="n">' + (o ? '−' : '') + per + '<small>hr/wk</small></div><div class="pot">SC-' + esc(c) + ' · ' + esc(codeName(c)) + '</div><div class="usd">' + (o ? 'over by ' : '') + fmt(Math.abs(h)) + (h > 0.005 ? ' · ' + (h / rate).toFixed(0) + ' hr at $' + rate.toFixed(2) : '') + '</div></div>';
    }).join('') || '<div class="fig"><div class="usd dim">No hourly lines in this proposal.</div></div>';

    var codesTxt = function (cs) { return cs.map(function (c) { return 'SC-' + c; }).join(' and '); };
    var allZero = figCodes.length && figCodes.every(function (c) { return Math.abs(head(c)) < 0.5; });
    $('heroCap').textContent = fits && allZero ? 'Every dollar in these codes is already spoken for by the proposal below — the plan is fully allocated. Lower a line (or raise a budget) and the room shows up here.'
      : fits ? 'Hours per week a new person could bill in each code from today to ' + mdy(X.yearEnd) + ' without cutting anyone, at that code’s main rate. Codes do not mix: one code’s money cannot pay for another’s service.'
      : 'This proposal overspends ' + codesTxt(overCodes) + '. Trim lines in that code until the stamp turns green.';
    var stmp = $('stamp'); stmp.textContent = fits ? 'Fits' : 'Over'; stmp.classList.toggle('over', !fits);
    if (lastVerdict !== null && lastVerdict !== fits) { stmp.classList.remove('re'); void stmp.offsetWidth; stmp.classList.add('re'); }

    var unclaimed = X.codes.reduce(function (s, c) { return s + Math.max(0, head(c)); }, 0);
    $('vBig').textContent = fits ? fmt0(unclaimed) + ' unclaimed' : '−' + fmt0(worstOver);
    $('vBig').className = 'big' + (fits ? '' : ' over');
    $('vTxt').innerHTML = fits
      ? 'left across all codes at this proposal — ' + X.codes.map(function (c) { return '<b>SC-' + esc(c) + ' ' + signed(head(c)) + '</b>'; }).join(' · ') + '. Whole plan ' + fmt(totalFc) + ' of ' + fmt(planTotal) + ' (' + (planTotal ? totalFc / planTotal * 100 : 0).toFixed(1) + '%). Unused money in a code is forfeited on ' + esc(mdy(X.yearEnd)) + '.'
      : 'must come off <b>' + esc(codesTxt(overCodes)) + '</b> — a code cannot borrow from another. Whole plan ' + fmt(totalFc) + ' of ' + fmt(planTotal) + '.';
    var liveMsg = (fits ? 'Fits. ' + fmt0(unclaimed) + ' unclaimed across all codes.' : 'Over budget in ' + codesTxt(overCodes) + ' by ' + fmt0(worstOver) + '.');
    clearTimeout(liveT);
    if (lastVerdict !== fits) $('vLive').textContent = liveMsg; // flips announce at once
    else liveT = setTimeout(function () { $('vLive').textContent = liveMsg; }, 700);
    lastVerdict = fits;

    $('tPlan').textContent = fmt(planTotal); $('tCommitted').textContent = fmt(X.committed); $('tAvail').textContent = fmt(planTotal - X.committed);
    $('tForecast').textContent = fmt(totalFc); $('tUnused').textContent = fmt(planTotal - totalFc);
    lines.forEach(function (L, i) { var el = document.querySelector('[data-mo="' + i + '"]'); if (el) el.textContent = fmt(yr(L) / monthsFrom(L.start)); });
    refreshScenarios();
  }

  function syncRow(tr, L) {
    var wk = weeksFrom(L.start), mo = monthsFrom(L.start), q = function (k) { return tr.querySelector('[data-k="' + k + '"]'); }, e;
    if ((e = q('wk')) && document.activeElement !== e) e.value = (L.hours / wk).toFixed(2);
    if ((e = q('mo')) && document.activeElement !== e) e.value = (L.hours / mo).toFixed(1);
    if ((e = q('hrs')) && document.activeElement !== e) e.value = (+L.hours).toFixed(1);
    if ((e = q('dol')) && document.activeElement !== e) e.value = money(yr(L));
  }

  /* ------------------------------------------------------------------ events: proposal */
  $('calcBody').addEventListener('focusin', function (e) { if (!refocusing && e.target.matches('input,select')) snap(); });
  $('calcBody').addEventListener('input', function (e) {
    var t = e.target, L = lines[+t.dataset.i], k = t.dataset.k; if (!L) return; var v = t.value;
    if (k === 'hrs') L.hours = Math.max(0, +v || 0);
    else if (k === 'wk') L.hours = Math.max(0, +v || 0) * weeksFrom(L.start);
    else if (k === 'mo') L.hours = Math.max(0, +v || 0) * monthsFrom(L.start);
    else if (k === 'dol') { if (L.fixed) { L.rate = num(v); L.hours = 1; } else L.hours = L.rate ? num(v) / L.rate : 0; }
    else if (k === 'rate') { L.rate = Math.max(0, +v || 0); if (L.pendingDollars && L.rate > 0) { L.hours = L.pendingDollars / L.rate; delete L.pendingDollars; } }
    else if (k === 't') { L.provider = v; t.title = v; }
    else return;
    syncRow(t.closest('tr'), L); rollup(); save();
  });
  $('calcBody').addEventListener('focusout', function (e) {
    var t = e.target, k = t.dataset && t.dataset.k, L = t.dataset && lines[+t.dataset.i]; if (!L) return;
    if (k === 'dol') t.value = money(yr(L));
    if (k === 't') { var c = t.closest('tr').querySelector('.chip'); if (c) c.outerHTML = chip(L, billedFor(L)); }
  });
  $('calcBody').addEventListener('change', function (e) {
    var t = e.target, L = lines[+t.dataset.i], k = t.dataset.k; if (!L) return;
    if (k === 'convrate') {
      var cr = num(t.value); if (!cr) return;
      snap(); var amt0 = yr(L); L.fixed = false; L.rate = cr; L.hours = amt0 / cr; if (!L.service || L.service === 'fixed') L.service = 'hourly';
      if (!(L.service in X.rateBySvc)) X.rateBySvc[L.service] = cr;
      render(); save(); $('saveStatus').textContent = (L.provider || 'line') + ': ' + fmt(amt0) + ' at $' + cr.toFixed(2) + '/hr = ' + L.hours.toFixed(1) + ' hr/yr';
      var rr = $('calcBody').children[+t.dataset.i], ri = rr && rr.querySelector('[data-k="wk"]'); if (ri) { refocusing = true; ri.focus(); refocusing = false; }
      return;
    }
    if (k === 'c') { L.code = t.value; }
    else if (k === 'st') { var wk0 = L.hours / weeksFrom(L.start); L.start = t.value; if (!L.fixed) L.hours = wk0 * weeksFrom(L.start); } // keep hr/wk
    else if (k === 'svc') {
      var v = t.value, amt = yr(L);
      if (v === 'fixed') { L.fixed = true; L.rate = L.pendingDollars || amt; L.hours = 1; delete L.pendingDollars; }
      else {
        var was = L.fixed; L.fixed = false; L.service = v; L.rate = X.rateBySvc[v] || (was ? 0 : L.rate);
        // Never guess a rate (SPEC rule 3): with none known, hold the dollars until the user types one.
        if (was) { if (L.rate) L.hours = amt / L.rate; else { L.hours = 0; L.pendingDollars = amt; } }
      }
    } else return;
    var ci = Array.prototype.indexOf.call(t.closest('tr').children, t.closest('td'));
    render(); save();
    if (L.pendingDollars) $('saveStatus').textContent = 'enter the hourly rate from your plan for ' + (L.provider || 'this line') + ' — its ' + fmt(L.pendingDollars) + ' becomes hours';
    var row = $('calcBody').children[+t.dataset.i]; var back = row && row.children[ci] && row.children[ci].querySelector('select,input'); if (back) { refocusing = true; back.focus(); refocusing = false; } // keep keyboard position; not a new undo step
  });
  $('calcBody').addEventListener('click', function (e) {
    var d = e.target.closest('[data-del]');
    if (d) { snap(); var i = +d.dataset.del, nm = lines[i].provider; lines.splice(i, 1); render(); save(); $('saveStatus').textContent = 'removed ' + (nm || 'line') + ' — Undo to restore'; var nx = $('calcBody').querySelector('[data-del="' + Math.min(i, lines.length - 1) + '"]') || $('addBtn'); nx.focus(); return; }
    var f = e.target.closest('[data-fill]');
    if (f) {
      snap(); var fi = +f.dataset.fill, L = lines[fi];
      if (M.fill) { var r = M.fill(L, lines, auth); if (L.fixed) L.rate = r.rate; else L.hours = r.hours; }
      else { var F = M.forecast(lines, auth), h = F.byCode[L.code] ? F.byCode[L.code].headroom : 0; if (L.fixed) L.rate = Math.max(0, L.rate + h); else if (L.rate) L.hours = Math.max(0, L.hours + h / L.rate); }
      render(); save(); $('saveStatus').textContent = 'filled SC-' + L.code + ' to $0';
      var fb = $('calcBody').querySelector('[data-fill="' + fi + '"]'); if (fb) fb.focus();
    }
  });
  $('budgets').addEventListener('focusin', function (e) { if (e.target.dataset && e.target.dataset.auth) snap(); });
  $('budgets').addEventListener('input', function (e) { var t = e.target; if (!t.dataset || !t.dataset.auth) return; auth[t.dataset.auth] = num(t.value); refreshBudgetRefs(); rollup(); save(); });
  $('budgets').addEventListener('focusout', function (e) { var t = e.target; if (t.dataset && t.dataset.auth) t.value = money(auth[t.dataset.auth]); });

  $('addBtn').addEventListener('click', function () {
    snap();
    var c = X.codes.filter(function (c) { return potRate(c) > 0; })[0] || X.codes[0];
    var svc = null; lines.forEach(function (L) { if (!svc && L.code === c && !L.fixed) svc = L.service; });
    svc = svc || Object.keys(X.rateBySvc)[0] || 'hourly';
    var m = X.months[Math.min(X.months.length - 1, Math.max(0, X.monthsElapsed))];
    lines.push({ id: 'new' + Date.now(), provider: 'New line', code: c, service: svc, rate: X.rateBySvc[svc] || potRate(c) || 0, hours: 0, start: m, fixed: false });
    render(); save();
    var inp = $('calcBody').querySelector('tr:last-child input.t'); if (inp) { inp.focus(); inp.select(); }
  });
  $('undoBtn').addEventListener('click', undo);
  $('resetBtn').addEventListener('click', function () { snap(); lines = normalize(clone(X.defaults)); auth = clone(X.auth0); render(); save(); $('saveStatus').textContent = 'reset to the plan — Undo to go back'; });
  $('printBtn').addEventListener('click', function () { window.print(); });

  /* ------------------------------------------------------------------ scenarios */
  function scList() { return fetchKey(SKEY) || {}; }
  function refreshScenarios() {
    var o = scList(), s = $('scnSel'), keep = s.value;
    s.innerHTML = '<option value="">— saved proposals —</option>' + Object.keys(o).sort().map(function (n) {
      var t = o[n].saved ? new Date(o[n].saved).toLocaleDateString() : '';
      return '<option value="' + esc(n) + '"' + (n === keep ? ' selected' : '') + '>' + esc(n) + (t ? ' · ' + esc(t) : '') + '</option>';
    }).join('');
    $('scnDel').disabled = !s.value;
  }
  $('scnSave').addEventListener('click', function () {
    var o = scList(), n = ($('scnName').value || '').trim() || 'Proposal ' + (Object.keys(o).length + 1);
    o[n] = { saved: new Date().toISOString(), lines: lines, auth: auth }; store(SKEY, o);
    $('scnName').value = ''; refreshScenarios(); $('scnSel').value = n; $('scnDel').disabled = false; $('saveStatus').textContent = 'saved proposal “' + n + '”';
  });
  $('scnSel').addEventListener('change', function () {
    var n = this.value, o = scList(); $('scnDel').disabled = !n; if (!n || !o[n]) return;
    snap(); lines = normalize(clone(o[n].lines)); auth = clone(o[n].auth || X.auth0); render(); save(); $('scnSel').value = n; $('scnDel').disabled = false; $('saveStatus').textContent = 'loaded “' + n + '”';
  });
  $('scnDel').addEventListener('click', function () { var n = $('scnSel').value; if (!n) return; var o = scList(); delete o[n]; store(SKEY, o); $('scnSel').value = ''; refreshScenarios(); $('saveStatus').textContent = 'deleted “' + n + '”'; });

  /* ------------------------------------------------------------------ export / import / clear */
  $('exportBtn').addEventListener('click', function () {
    var d = new Date(), blob = new Blob([JSON.stringify({ app: 'sdp-planner', v: 1, saved: d.toISOString(), dataset: X.ds, lines: lines, auth: auth, scenarios: scList() }, null, 2)], { type: 'application/json' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'sdp-planner-' + d.toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
    $('saveStatus').textContent = 'exported ' + a.download;
  });
  $('importBtn').addEventListener('click', function () { $('importFile').click(); });
  $('importFile').addEventListener('change', function (e) { var f = e.target.files[0]; if (f) importJSONFile(f); e.target.value = ''; });
  function importJSONFile(f) {
    var r = new FileReader();
    r.onload = function () {
      var msg = function (t) { if (X && !$('app').hidden) $('saveStatus').textContent = t; else $('obStatus').textContent = t; };
      try {
        var o = JSON.parse(r.result);
        if (o.scenarios) { var cur = scList(); Object.keys(o.scenarios).forEach(function (n) { cur[n] = o.scenarios[n]; }); store(SKEY, cur); }
        if (o.dataset && o.dataset.plan) { start(o.dataset, false, { lines: o.lines || [], auth: o.auth }); if (!o.lines) { lines = normalize(clone(X.defaults)); render(); } save(); msg('imported ' + f.name); }
        else if (X && Array.isArray(o.lines)) { snap(); lines = normalize(o.lines); if (o.auth) auth = o.auth; render(); save(); msg('imported ' + f.name); }
        else msg('That file has no plan in it — load your .xlsx files first.');
      } catch (err) { msg('import failed: not a sdp-planner .json file'); }
    };
    r.readAsText(f);
  }
  $('clearBtn').addEventListener('click', function () {
    if (!window.confirm('Erase your proposal, saved scenarios and loaded files from this browser? Export first if you want a copy.')) return;
    store(KEY, null); store(SKEY, null); X = null; lines = []; auth = {}; pending = {}; hist = [];
    $('found').innerHTML = ''; updateOpen(); $('obStatus').textContent = 'Cleared. Nothing of yours is stored in this browser now.';
    $('kicker').innerHTML = '<span>Self-Determination Program</span><span>Plan tracker</span><span>Runs in your browser</span>'; $('ghost').textContent = 'SDP';
    $('meta').textContent = 'Drop in the spending plan and the FMS year-to-date report you already receive. Nothing is uploaded anywhere.'; $('srcLine').textContent = '';
    showOnboard(true); $('drop').focus();
  });
  $('swapBtn').addEventListener('click', function () { pending = {}; $('found').innerHTML = ''; updateOpen(); showOnboard(true); $('drop').focus(); });
  $('backBtn').addEventListener('click', function () { showOnboard(false); });

  /* ------------------------------------------------------------------ events: onboarding */
  var drop = $('drop');
  drop.addEventListener('click', function () { $('fileInput').click(); });
  drop.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('fileInput').click(); } });
  ['dragenter', 'dragover'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
  ['dragleave', 'drop'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
  drop.addEventListener('drop', function (e) { handleFiles(e.dataTransfer && e.dataTransfer.files); });
  window.addEventListener('dragover', function (e) { e.preventDefault(); }); // a missed drop must not navigate away
  window.addEventListener('drop', function (e) { e.preventDefault(); });
  $('fileInput').addEventListener('change', function (e) { handleFiles(e.target.files); e.target.value = ''; });
  $('openBtn').addEventListener('click', function () {
    var p = pending.plan; if (!p) return;
    var r = pending.report;
    start({ source: 'files', plan: p.data, report: r ? r.data : null, files: [p.name].concat(r ? [r.name] : []) }, true);
    pending = {}; $('found').innerHTML = ''; updateOpen();
  });
  $('demoBtn').addEventListener('click', function () {
    var d = SDP.demo; start({ source: 'demo', plan: clone(d.plan), report: clone(d.report), files: [] }, true);
  });

  /* ------------------------------------------------------------------ automation hook (read-only snapshot) */
  SDP.app = { state: function () { return X ? clone({ lines: lines, auth: auth }) : null; } };

  /* ------------------------------------------------------------------ boot */
  var saved = fetchKey(KEY);
  if (saved && saved.dataset && saved.dataset.plan) {
    try { start(saved.dataset, false, saved); }
    catch (err) { if (window.console) console.warn('[sdp-planner] saved state unreadable, starting fresh', err); showOnboard(true); }
  } else {
    showOnboard(true);
  }
  // test hook: ?demo=1 opens the demo directly (used by headless screenshots / smoke tests)
  try { if (!X && new URLSearchParams(location.search).get('demo')) $('demoBtn').click(); } catch (e) { }
})();
