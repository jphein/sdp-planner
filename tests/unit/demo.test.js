const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../../demo/demo-data.js');
const M = require('../../model.js');

test('demo: plan is self-consistent and roughly a real-sized plan', () => {
  const { plan } = D;
  const codes = Object.keys(plan.codes).sort();
  assert.deepEqual(codes, ['320', '331', '338', '340', '358']);
  const sum = codes.reduce((s, c) => s + plan.codes[c].auth, 0);
  assert.equal(M.cents(sum), plan.total);
  assert.ok(plan.total > 90000 && plan.total < 110000, String(plan.total));
  for (const c of codes) {
    const lines = plan.lines.filter(L => L.code === c).reduce((s, L) => s + L.yearly, 0);
    assert.equal(M.cents(lines), plan.codes[c].auth, 'code ' + c);
  }
  for (const L of plan.lines) assert.equal(M.cents(L.unitsPerYear * L.rate), L.yearly);
});

test('demo: report totals reconcile to its rows, dates inside the plan year', () => {
  const { plan, report } = D;
  for (const [c, b] of Object.entries(report.byCode)) {
    const rs = report.rows.filter(r => r.code === c);
    assert.equal(M.cents(rs.reduce((s, r) => s + r.spent, 0)), b.spent, c);
    assert.equal(M.cents(rs.reduce((s, r) => s + r.alloc, 0)), b.alloc, c);
    assert.equal(M.cents(plan.codes[c].auth - b.spent - b.alloc), b.available, c);
  }
  const provTotal = Object.values(report.byProvider).reduce((s, v) => s + v, 0);
  const rowTotal = report.rows.reduce((s, r) => s + r.spent + r.alloc, 0);
  assert.equal(M.cents(provTotal), M.cents(rowTotal));
  const months = new Set(M.planMonths(plan.planYear));
  assert.ok(report.rows.every(r => months.has(r.month)));
  const latest = report.rows.map(r => r.date.slice(6) + '-' + r.date.slice(0, 2) + '-' + r.date.slice(3, 5)).sort().at(-1);
  assert.equal(report.asOf, latest);
});

test('demo: 2 PA/ILS providers, 4 TDS providers, obviously fake identifiers', () => {
  const { plan } = D;
  const provs = s => new Set(plan.lines.filter(L => M.serviceLabel(L.description) === s || (s === 'PA/ILS' && L.code === '320')).flatMap(L => L.providers));
  assert.equal(provs('PA/ILS').size, 2);
  assert.equal(plan.lines.filter(L => M.serviceLabel(L.description) === 'TDS').length, 4);
  assert.equal(plan.participant.uci, '0000000');
  assert.equal(plan.fms.vendorNumber, 'ZZ0000');
});

test('demo: the default proposal fits and the pace view has data', () => {
  const lines = M.buildProposal(D.plan);
  const f = M.forecast(lines, D.plan);
  assert.equal(f.fits, true);
  assert.ok(lines.every(L => !L.fixed || ['Membership', 'Transport', 'IF', 'PERS', 'Community Integration Supports'].includes(L.service)));
  const p = M.pace(D.report, D.plan);
  assert.equal(p.monthsElapsed, 2);
  assert.ok(Object.values(p.byCode).some(c => c.diff > 0) && Object.values(p.byCode).some(c => c.diff < 0), 'demo shows both ahead and behind');
});
