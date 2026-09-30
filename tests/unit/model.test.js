const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../../model.js');
const parsers = require('../../parsers/index.js');
const { planWorkbook, reportWorkbook } = require('./ace-workbooks.js');

const END = '2027-08-31';
const PY = { start: '2026-09-01', end: END };

test('weeksFrom: start month through year end, inclusive, fractional', () => {
  assert.equal(M.weeksFrom('2026-09', END), 365 / 7);           // full plan year = 52.14 wk
  assert.equal(M.weeksFrom('2026-10', END), 335 / 7);
  assert.equal(M.weeksFrom('2027-08', END), 31 / 7);            // last month
  assert.equal(M.weeksFrom('2027-08', { planYear: PY }), 31 / 7, 'accepts a Plan');
  assert.equal(M.weeksFrom('2027-09', END), 1, 'past year end clamps to 1 so hr/wk stays defined');
  // A leap-year February and a DST boundary must not produce fractional days.
  assert.equal(M.weeksFrom('2028-02', '2028-02-29'), 29 / 7);
  assert.equal(M.weeksFrom('2026-11', '2026-11-30'), 30 / 7);
});

test('monthsFrom / planMonths', () => {
  assert.equal(M.monthsFrom('2026-09', END), 12);
  assert.equal(M.monthsFrom('2026-10', END), 11);
  assert.equal(M.monthsFrom('2027-08', END), 1);
  assert.equal(M.monthsFrom('2027-12', END), 1);
  assert.deepEqual(M.planMonths(PY).slice(0, 5), ['2026-09', '2026-10', '2026-11', '2026-12', '2027-01']);
  assert.equal(M.planMonths(PY).length, 12);
  assert.equal(M.planMonths({ start: '2026-07-01', end: '2027-06-30' }).at(-1), '2027-06');
});

test('yearly / hr per week / hr per month', () => {
  const L = { code: '320', rate: 40, hours: 520, start: '2026-09', fixed: false };
  assert.equal(M.yearly(L), 20800);
  assert.equal(M.yearly({ rate: 960, fixed: true, hours: 99 }), 960, 'fixed lines ignore hours');
  assert.ok(Math.abs(M.hoursPerWeek(L, END) - 520 / (365 / 7)) < 1e-12);
  assert.equal(M.hoursPerMonth(L, END), 520 / 12);
  assert.equal(M.hoursPerWeek({ fixed: true }, END), null);
});

test('buildProposal: hourly lines from the RATE column, weekly lines stay fixed $ without a user rate', () => {
  const plan = parsers.ace.plan(planWorkbook());
  const lines = M.buildProposal(plan);
  assert.equal(lines.length, plan.lines.length);
  const pa = lines[0];
  assert.deepEqual([pa.provider, pa.code, pa.service, pa.rate, pa.hours, pa.start, pa.fixed], ['Alex Rivera', '320', 'PA', 35, 600, '2026-09', false]);
  assert.deepEqual(pa.alternates, ['Sam Okafor']);
  const tds = lines.filter(L => L.service === 'TDS');
  assert.ok(tds.every(L => L.fixed), 'no hourly rate is inferred from $200/wk');
  assert.deepEqual(tds.map(M.yearly), [10400, 5200]);
  assert.equal(new Set(lines.map(L => L.id)).size, lines.length, 'ids are unique');
  // Default proposal = plan lines, so every code's proposal equals its line sum.
  const f = M.forecast(lines, plan);
  assert.equal(f.byCode['320'].proposal, 27000);
  assert.equal(f.byCode['331'].proposal, 18960);
});

test('buildProposal: a user hourly rate converts weekly lines only (memberships stay fixed)', () => {
  const plan = parsers.ace.plan(planWorkbook());
  const lines = M.buildProposal(plan, null, { rates: { '331': 40 }, start: '2026-10' });
  const tds = lines.filter(L => L.service === 'TDS');
  assert.ok(tds.every(L => !L.fixed && L.rate === 40));
  assert.deepEqual(tds.map(L => L.hours), [260, 130]);
  assert.deepEqual(tds.map(M.yearly), [10400, 5200], 'dollars unchanged by the conversion');
  assert.ok(lines.filter(L => L.code === '331' && L.service !== 'TDS').every(L => L.fixed));
  assert.ok(lines.every(L => L.start === '2026-10'));
});

test('buildProposal: last year basis uses last year $ ÷ last year rate, only when that rate is given', () => {
  const plan = parsers.ace.plan(planWorkbook());
  const lastYear = parsers.ace.report(reportWorkbook());
  const plain = M.buildProposal(plan, lastYear);
  assert.equal(plain[0].lastYear, 3430, 'Alex Rivera 320: 1750 spent + 1680 allocated');
  assert.equal(plain[0].hours, 600, 'without basis:lastYear hours stay from the plan');
  const ly = M.buildProposal(plan, lastYear, { basis: 'lastYear', lastYearRates: { '320:PA': 34 } });
  assert.equal(ly[0].hours, 3430 / 34, 'last year $ ÷ last year rate, not this year rate');
  assert.equal(ly[1].hours, 120, 'ILS has no last-year rate → plan hours kept');
  // Prefix match: plan "Example Climbing" ↔ report "Example Climbing Gym".
  assert.equal(plain.find(L => L.provider === 'Example Climbing').lastYear, 240);
});

test('forecast: headroom by code, no borrowing across codes', () => {
  const auth = { '320': 1000, '331': 1000 };
  const lines = [
    { id: 'a', code: '320', rate: 50, hours: 10, fixed: false },   // 500
    { id: 'b', code: '331', rate: 1100, fixed: true }              // 1100 → over by 100
  ];
  const f = M.forecast(lines, auth);
  assert.equal(f.byCode['320'].headroom, 500);
  assert.equal(f.byCode['331'].headroom, -100);
  assert.equal(f.fits, false, '320 has $500 spare but 331 cannot use it');
  assert.deepEqual(f.overCodes, ['331']);
  assert.equal(f.total, 1600);
  assert.equal(f.totals.headroom, 400, 'the total looks fine; the code-level verdict is what counts');
});

test('forecast: under-spend in a code is forfeit at year end', () => {
  const f = M.forecast([{ code: '320', rate: 30, hours: 100, fixed: false }], { '320': 5000, '340': 600 });
  assert.equal(f.fits, true);
  assert.equal(f.byCode['320'].forfeit, 2000);
  assert.equal(f.byCode['340'].forfeit, 600, 'a code with no lines forfeits its whole authorization');
  assert.equal(f.totals.forfeit, 2600);
  assert.equal(f.byCode['320'].over, 0);
});

test('forecast: accepts plan.codes shape and unknown codes; cent tolerance', () => {
  const plan = { codes: { '320': { name: 'x', auth: 100 } } };
  const f = M.forecast([{ code: 320, rate: 0.1, hours: 1000, fixed: false }, { code: '999', rate: 5, fixed: true }], plan);
  assert.equal(f.byCode['320'].headroom, 0);
  assert.equal(f.byCode['320'].fits, true, '0.1 × 1000 must not be over by float noise');
  assert.deepEqual(f.overCodes, ['999'], 'a line in a code with no authorization is over');
});

test('fill: a line takes exactly what is left in its code', () => {
  const auth = { '331': 1000 };
  const a = { id: 'a', code: '331', rate: 40, hours: 10, fixed: false };  // 400
  const b = { id: 'b', code: '331', rate: 100, fixed: true };             // 100
  assert.equal(M.fill(a, [a, b], auth).hours, 900 / 40);
  assert.equal(M.fill(b, [a, b], auth).rate, 600);
  const big = { id: 'c', code: '331', rate: 2000, fixed: true };
  assert.equal(M.fill(a, [a, big], auth).hours, 0, 'never negative');
});

test('monthsElapsed: a month counts once the next has begun (arrears), clamped', () => {
  const plan = { planYear: PY };
  assert.equal(M.monthsElapsed(plan, '2026-09-15'), 1, 'floor of 1');
  assert.equal(M.monthsElapsed(plan, '2026-10-01'), 1);
  assert.equal(M.monthsElapsed(plan, '2026-12-05'), 3);
  assert.equal(M.monthsElapsed(plan, '2027-09-30'), 12, 'cap at plan length');
});

test('pace: committed vs straight-line expected, by code', () => {
  const plan = parsers.ace.plan(planWorkbook());
  const report = parsers.ace.report(reportWorkbook());
  const p = M.pace(report, plan, '2026-11-02');
  assert.equal(p.monthsElapsed, 2);
  assert.equal(p.months, 12);
  const c = p.byCode['320'];
  assert.equal(c.auth, 27000);
  assert.equal(c.spent, 2000);
  assert.equal(c.alloc, 1680);
  assert.equal(c.committed, 3680);
  assert.equal(c.available, 27000 - 3680);
  assert.equal(c.expected, 4500);
  assert.equal(c.diff, 3680 - 4500);
  assert.ok(Math.abs(c.pct - 3680 / 27000 * 100) < 1e-9);
  assert.equal(p.byCode['340'].committed, 0);
  assert.equal(p.byCode['340'].diff, -900);
  // Default asOf = the report's last service date.
  assert.equal(M.pace(report, plan).asOf, '2026-10-01');
  assert.equal(M.pace(report, plan).monthsElapsed, 1);
});

test('billed + monthGrid: by provider and SERVICE month', () => {
  const plan = parsers.ace.plan(planWorkbook());
  const report = parsers.ace.report(reportWorkbook());
  assert.equal(M.billed(report, 'Jordan Lee', '331'), 380);
  assert.equal(M.billed(report, 'Jordan Lee', '320'), 0, 'per code, never pooled');
  const g = M.monthGrid(report, plan);
  assert.equal(g.months.length, 12);
  const alex = g.rows.find(r => r.provider === 'Alex Rivera' && r.code === '320');
  assert.deepEqual(alex.byMonth, { '2026-09': 1750, '2026-10': 1680 });
  assert.equal(alex.total, 3430);
});
