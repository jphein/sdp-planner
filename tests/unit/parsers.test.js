const test = require('node:test');
const assert = require('node:assert/strict');
const { XLSX, planWorkbook, reportWorkbook, AUTH } = require('./ace-workbooks.js');
const parsers = require('../../parsers/index.js');

test('detect: plan, report, and unknown workbooks', () => {
  assert.equal(parsers.detect(planWorkbook()), 'ace-plan');
  assert.equal(parsers.detect(reportWorkbook()), 'ace-report');
  const other = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(other, XLSX.utils.aoa_to_sheet([['hello', 'world']]), 'Sheet1');
  assert.equal(parsers.detect(other), null);
  assert.equal(parsers.detect(null), null);
  assert.throws(() => parsers.parse(other), /Unrecognized workbook/);
});

test('plan: header, participant, FMS, plan year', () => {
  const { kind, data: p } = parsers.parse(planWorkbook());
  assert.equal(kind, 'ace-plan');
  assert.deepEqual(p.planYear, { start: '2026-09-01', end: '2027-08-31' });
  assert.equal(p.participant.name, 'Riley Sample');
  assert.equal(p.participant.uci, '0');
  assert.equal(p.participant.dob, undefined, 'DOB is never read');
  assert.equal(p.coordinator, 'Pat Example');
  assert.equal(p.fms.code, '316');
  assert.equal(p.fms.monthlyFee, 800);
  assert.equal(p.fms.vendorNumber, 'ZZ0000');
  assert.equal(p.fms.model, 'Co-Employer');
  assert.equal(p.total, 56320);
});

test('plan: lines keep the RATE column verbatim and skip the FMS line', () => {
  const p = parsers.ace.plan(planWorkbook());
  assert.equal(p.lines.length, 9);
  assert.ok(!p.lines.some(L => L.code === '316'), 'FMS fee is outside the SDP budget');
  const pa = p.lines[0];
  assert.deepEqual([pa.code, pa.unit, pa.unitsPerYear, pa.rate, pa.yearly], ['320', 'hour', 600, 35.00, 21900]);
  assert.deepEqual(pa.providers, ['Alex Rivera', 'Sam Okafor']);
  const tds = p.lines.find(L => L.code === '331' && L.unit === 'week');
  assert.equal(tds.rate, 200, 'weekly budget line rate is the plan RATE ($/wk), not an hourly rate');
  assert.equal(p.codes['320'].category, 'Living Arrangement (310-321)');
  assert.equal(p.codes['358'].category, 'Health & Safety (356-377)');
});

test('plan: authorizations come from the SDP Authorizations block, by code', () => {
  const p = parsers.ace.plan(planWorkbook());
  const auth = Object.fromEntries(Object.entries(p.codes).map(([c, v]) => [c, v.auth]));
  assert.deepEqual(auth, { 320: 27900, 331: 22620, 338: 340, 340: 5400, 358: 60 });
  assert.equal(p.checks.authFromSheet, true);
  assert.equal(p.checks.linesTotal, 52620);
  assert.equal(p.checks.authTotal, 56320);
});

test('report: rows, service dates, codes, invoices', () => {
  const { kind, data: r } = parsers.parse(reportWorkbook());
  assert.equal(kind, 'ace-report');
  assert.deepEqual(r.participant, { name: 'Riley Sample', uci: '0000000' });
  assert.equal(r.rows.length, 9, 'starting-balance and Total rows are not ledger rows');
  assert.equal(r.planStart, '2026-09-01');
  assert.equal(r.asOf, '2026-10-01');
  const first = r.rows[0];
  assert.deepEqual([first.date, first.month, first.code, first.provider, first.spent, first.invoice],
    ['09/01/2026', '2026-09', '320', 'Alex Rivera', 1825, 'INV-1']);
  assert.ok(r.rows.every(x => x.invoice), 'every row gets its invoice # from the copy sheet');
  const refund = r.rows.find(x => x.spent < 0);
  assert.equal(refund.spent, -20, 'negative adjustments are kept');
  const allocated = r.rows.find(x => x.alloc > 0);
  assert.deepEqual([allocated.code, allocated.alloc, allocated.spent], ['320', 1752, 0]);
});

test('report: byCode/byProvider reconcile with SVC + Provider Report', () => {
  const r = parsers.ace.report(reportWorkbook());
  assert.equal(r.checks.ok, true, JSON.stringify(r.checks.mismatches));
  assert.equal(r.checks.crossChecked, true);
  assert.deepEqual(r.byCode['331'], { spent: 752.5, alloc: 0, available: AUTH[331] - 752.5, start: AUTH[331], name: 'Community Integration Supports' });
  assert.equal(r.byCode['340'].available, 5400);
  assert.equal(r.byProvider['Alex Rivera'], 1825 + 1752);
  assert.equal(r.byProvider['Priya Natarajan'], 132.5);
});

test('report: a tampered SVC sheet is reported, not swallowed', () => {
  const r = parsers.ace.report(reportWorkbook({ tamperSvc: true }));
  assert.equal(r.checks.ok, false);
  assert.deepEqual(r.checks.mismatches.map(m => [m.sheet, m.code, m.field]), [['SVC', '331', 'spent']]);
});

test('report: real Excel date cells parse the same as text dates', () => {
  const a = parsers.ace.report(reportWorkbook());
  const b = parsers.ace.report(reportWorkbook({ dateSerials: true }));
  assert.deepEqual(b.rows.map(x => x.date), a.rows.map(x => x.date));
  assert.equal(b.asOf, a.asOf);
});

test('fromArrayBuffer: bytes → parse', () => {
  const bytes = XLSX.write(planWorkbook(), { type: 'array', bookType: 'xlsx' });
  assert.equal(parsers.fromArrayBuffer(bytes, XLSX).kind, 'ace-plan');
});

test('registry: ace is registered; a new FMS module plugs in via register()', () => {
  assert.deepEqual(parsers.list(), [{ id: 'ace', label: 'ACE Financial Services' }]);
  assert.equal(parsers.ace.detect(planWorkbook()), 'plan');
  assert.equal(parsers.ace.detect(reportWorkbook()), 'report');
  assert.equal(parsers.parse(planWorkbook()).fms, 'ace');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['EXAMPLE FMS PLAN']]), 'Plan');
  parsers.register({ id: 'examplefms', label: 'Example FMS', detect: w => w.SheetNames[0] === 'Plan' ? 'plan' : null,
                     plan: () => ({ total: 1 }), report: () => ({}) });
  assert.equal(parsers.detect(wb), 'examplefms-plan');
  assert.deepEqual(parsers.parse(wb), { kind: 'examplefms-plan', fms: 'examplefms', data: { total: 1 } });
  assert.equal(parsers.detect(planWorkbook()), 'ace-plan', 'existing FMS still wins its own files');
  assert.throws(() => parsers.register({ id: 'bad' }), /needs/);
});
