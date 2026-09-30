/* demo/demo-data.js — a SYNTHETIC plan + YTD report so the page works with zero files.
 * Every name, number, UCI, vendor and invoice here is invented. Shapes match the parsers'
 * output (docs/SPEC.md: Plan, Report), so the UI treats demo data exactly like imported data.
 *
 * Plan year Jul 2026 – Jun 2027 (SDP plan years follow the participant's own dates, not the
 * calendar). The report holds July + August service and the first posted September rows,
 * as a mid-September YTD report would.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') {
    window.SDP = window.SDP || {};
    window.SDP.demo = api;
  }
})(this, function () {
  'use strict';
  function cents(x) { return Math.round(x * 100) / 100; }

  var CODES = {
    '320': { name: 'Community Living Supports', category: 'Living Arrangement (310-321)' },
    '331': { name: 'Community Integration Supports', category: 'Employment & Community Participation (331-340)' },
    '338': { name: 'Non-Medical Transportation', category: 'Employment & Community Participation (331-340)' },
    '340': { name: 'Independent Facilitator', category: 'Employment & Community Participation (331-340)' },
    '358': { name: 'Personal Emergency Response Systems', category: 'Health & Safety (356-377)' }
  };
  // [code, description, provider text, units, unitType, frequency, rate]
  var PLAN_LINES = [
    ['320', 'Personal Attendant supports', 'Alex Rivera or Sam Okafor', 80, 'Hour/Month', 12, 35.00],
    ['320', 'ILS', 'Sam Okafor', 30, 'Hour/Month', 12, 50.00],
    ['331', 'Community Integration Supports - TDS', 'Jordan Lee', 6, 'Hour/Week', 52, 38.00],
    ['331', 'Community Integration Supports - TDS', 'Priya Natarajan or Alex Rivera', 5, 'Hour/Week', 52, 38.00],
    ['331', 'Community Integration Supports - TDS', 'Morgan Blake', 4, 'Hour/Week', 52, 38.00],
    ['331', 'Community Integration Supports - TDS', 'Taylor Nguyen', 3, 'Hour/Week', 52, 38.00],
    ['331', 'Climbing Gym Membership', 'Example Climbing Co.', 12, 'Month/Year', 1, 80.00],
    ['331', 'Community Integration Supports', 'Example Media Studio', 40, 'Unit/Year', 1, 60.00],
    ['338', 'Non-Medical Transportation', 'Example Transit', 12, 'Month/Year', 1, 25.00],
    ['340', 'Independent Facilitator', 'Example Facilitation LLC', 12, 'Month/Year', 1, 450.00],
    ['358', 'Medical Alert Annual Membership', 'Example Alert Co.', 1, 'Year/Year', 1, 60.00]
  ];

  var lines = PLAN_LINES.map(function (p) {
    var perYear = p[3] * p[5];
    return {
      code: p[0], description: p[1], providerText: p[2], providers: p[2].split(/\s+or\s+/),
      units: p[3], unitType: p[4], frequency: p[5], unitsPerYear: perYear,
      unit: p[4].split('/')[0].toLowerCase(), rate: p[6], adjustedRate: p[6], oneTime: 0,
      yearly: cents(perYear * p[6])
    };
  });
  var codes = {};
  Object.keys(CODES).forEach(function (c) {
    codes[c] = { name: CODES[c].name, category: CODES[c].category,
                 auth: cents(lines.filter(function (L) { return L.code === c; }).reduce(function (s, L) { return s + L.yearly; }, 0)) };
  });
  var total = cents(Object.keys(codes).reduce(function (s, c) { return s + codes[c].auth; }, 0));

  var plan = {
    source: 'demo',
    planYear: { start: '2026-07-01', end: '2027-06-30' },
    participant: { name: 'Riley Sample (demo)', uci: '0000000' },
    coordinator: 'Pat Example',
    fms: { name: 'Example FMS (demo)', vendorNumber: 'ZZ0000', model: 'Co-Employer', code: '316', monthlyFee: 800 },
    codes: codes, lines: lines, total: total,
    checks: { authFromSheet: false, linesTotal: total, authTotal: total }
  };

  // ---- report rows: [MM/DD/YYYY service date, type, provider, code, description, spent, alloc, invoice] ----
  var R = [];
  function add(d, type, prov, code, desc, spent, alloc, inv) { R.push([d, type, prov, code, desc, spent, alloc || 0, inv]); }
  // Monthly invoices post under the 1st of the month served.
  add('07/01/2026', 'Service', 'Alex Rivera', '320', 'Personal attendant support', cents(76 * 35), 0, 'DEMO-1001');
  add('08/01/2026', 'Service', 'Alex Rivera', '320', 'Personal attendant support', cents(84 * 35), 0, 'DEMO-1014');
  // Weekly timesheets.
  ['07/06', '07/13', '07/20', '07/27', '08/03', '08/10', '08/17', '08/24', '08/31'].forEach(function (md, i) {
    var inv = i < 4 ? 'DEMO-1002' : 'DEMO-1015';
    add(md + '/2026', 'Service', 'Sam Okafor', '320', 'Independent living skills', cents(7 * 50), 0, inv);
    add(md + '/2026', 'Service', 'Jordan Lee', '331', 'Community outing', cents(6 * 38), 0, inv);
    if (i % 2 === 0) add(md + '/2026', 'Service', 'Priya Natarajan', '331', 'Community outing', cents(9 * 38), 0, inv);
    if (i >= 2) add(md + '/2026', 'Service', 'Morgan Blake', '331', 'Social skills group', cents(4 * 38), 0, inv);
    if (i === 1 || i === 6) add(md + '/2026', 'Service', 'Taylor Nguyen', '331', 'Art class support', cents(5 * 38), 0, inv);
  });
  ['07/01/2026', '08/01/2026'].forEach(function (d, i) {
    var inv = 'DEMO-20' + (i + 1);
    add(d, 'Goods Purchase', 'Example Climbing Co.', '331', 'Monthly membership', 80, 0, inv);
    add(d, 'Goods Purchase', 'Example Transit', '338', 'Monthly bus pass', 25, 0, inv);
    add(d, 'Service', 'Example Facilitation LLC', '340', 'Independent facilitation', 450, 0, inv);
  });
  add('07/15/2026', 'Goods Purchase', 'Example Alert Co.', '358', 'Annual membership', 60, 0, 'DEMO-2003');
  add('08/12/2026', 'Service', 'Example Media Studio', '331', 'Media class (2 sessions)', 120, 0, 'DEMO-2004');
  // First September rows: posted, and one still allocated (approved, not yet paid).
  add('09/01/2026', 'Goods Purchase', 'Example Climbing Co.', '331', 'Monthly membership', 80, 0, 'DEMO-2010');
  add('09/01/2026', 'Goods Purchase', 'Example Transit', '338', 'Monthly bus pass', 25, 0, 'DEMO-2010');
  add('09/07/2026', 'Service', 'Jordan Lee', '331', 'Community outing', 0, cents(6 * 38), 'DEMO-1030');

  var rows = R.map(function (r) {
    return { date: r[0], month: r[0].slice(6) + '-' + r[0].slice(0, 2), type: r[1], provider: r[2], code: r[3],
             description: r[4], spent: r[5], alloc: r[6], invoice: r[7] };
  });
  var byCode = {}, byProvider = {};
  Object.keys(codes).forEach(function (c) { byCode[c] = { spent: 0, alloc: 0, available: codes[c].auth, start: codes[c].auth, name: codes[c].name }; });
  rows.forEach(function (x) {
    var b = byCode[x.code];
    b.spent = cents(b.spent + x.spent); b.alloc = cents(b.alloc + x.alloc);
    b.available = cents(b.start - b.spent - b.alloc);
    byProvider[x.provider] = cents((byProvider[x.provider] || 0) + x.spent + x.alloc);
  });

  var report = {
    source: 'demo',
    asOf: '2026-09-07', planStart: '2026-07-01',
    participant: { name: 'Riley Sample (demo)', uci: '0000000' },
    rows: rows, byCode: byCode, byProvider: byProvider,
    checks: { ok: true, mismatches: [], crossChecked: false }
  };

  return { plan: plan, report: report };
});
