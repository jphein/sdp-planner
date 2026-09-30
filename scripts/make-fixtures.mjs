#!/usr/bin/env node
// Generate synthetic ACE-format workbooks for tests:
//   tests/fixtures/ace-plan.xlsx     — spending plan (sheet `Sheet2`)
//   tests/fixtures/ace-report.xlsx   — FMS YTD report (sheets `Report`, `SVC`, `copy`, `Provider Report`)
//   tests/fixtures/expected.json     — the numbers a correct parser must recover
//
// Every name, number, UCI and vendor id below is FAKE: round numbers, "Example …" vendors,
// UCI 0000000, vendor ZZ0000. The layout (sheet names, header strings, column positions,
// section/Total rows) mirrors real ACE exports; the data does not.
//
// Known quirk encoded on purpose: invoice 9000002 has two lines booked under SWAPPED codes
// (its attendant-care line sits in SC-331, its community-integration line sits in SC-320).
// The FMS report is the source of truth for what was booked where, so parsers must report
// the booked code, and totals must still tie to the SVC sheet.
//
// Run: node scripts/make-fixtures.mjs     (SHEETJS=/path/to/xlsx.full.min.js to override)
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const sheetjsPath = process.env.SHEETJS ? resolve(process.env.SHEETJS) : join(root, 'vendor', 'xlsx.full.min.js');
if (!existsSync(sheetjsPath)) {
  console.error(`SheetJS not found at ${sheetjsPath} — set SHEETJS=/path/to/xlsx.full.min.js`);
  process.exit(2);
}
const XLSX = require(sheetjsPath);
const outDir = join(root, 'tests', 'fixtures');
mkdirSync(outDir, { recursive: true });

const r2 = n => Math.round(n * 100) / 100;
const _ = null; // an empty cell

// ---------------------------------------------------------------- plan ----
const PLAN = {
  start: '09/01/2026', end: '08/31/2027', prepared: '07/01/2026',
  participant: 'Alex Rivera', uci: '0000000', dob: '01/01/2000', coordinator: 'Jordan Example',
  fms: { name: 'ACE FMS', vendor: 'ZZ0000', perMonth: 800 },
};
// [code, description, provider, units, unitType, frequency, rate, oneTime]
const GROUPS = [
  ['Living Arrangement (310-321)', 'Living Arrangement  Total', [
    ['320', 'Personal Attendant supports', 'Sam Jordan or Casey Park', 50, 'Hour/Month', 12, 30.00, 0],
    ['320', 'ILS', 'Morgan Lee or Sam Jordan', 20, 'Hour/Month', 12, 50.00, 0],
  ]],
  ['Employment & Community Participation (331-340)', 'Employment & Community Participation  Total', [
    ['331', 'Community Integration Supports', 'Casey Park or Riley Chen', 52, 'Week/Year', 1, 200.00, 0],
    ['331', 'Community Integration Supports', 'Taylor Quinn or Jamie Fox', 26, 'Week/Year', 1, 200.00, 0],
    ['338', 'Non-Medical Transportation', 'Example Transit', 12, 'Month/Year', 1, 25.00, 0],
    ['340', 'Independent Facilitator', 'Example Facilitation LLC', 12, 'Month/Year', 1, 500.00, 0],
    ['331', 'Example Climbing Gym Membership', 'Example Climbing Gym', 12, 'Month/Year', 1, 100.00, 0],
  ]],
  ['Health & Safety (356-377)', 'Health & Safety  Total', [
    ['358', 'Example Alert Annual Membership', 'Example Alert Co', 1, 'Year/Year', 1, 50.00, 0],
  ]],
];
const CODE_NAMES = {
  '320': 'Community Living Supports', '331': 'Community Integration Supports',
  '338': 'Non-Medical Transportation', '340': 'Independent Facilitator',
  '358': 'Personal Emergency Response Systems (PERS) ',
};
const CATEGORY = { '320': GROUPS[0][0], '331': GROUPS[1][0], '338': GROUPS[1][0], '340': GROUPS[1][0], '358': GROUPS[2][0] };

const planLines = [];
for (const [, , lines] of GROUPS) for (const [code, description, provider, units, unit, freq, rate, oneTime] of lines) {
  const yearlyUnits = units * freq;
  planLines.push({ code, description, providers: provider.split(' or '), provider, units, unit, freq,
    unitsPerYear: yearlyUnits, rate, oneTime, yearly: r2(yearlyUnits * rate + oneTime) });
}
const auth = {};
for (const l of planLines) auth[l.code] = r2((auth[l.code] || 0) + l.yearly);
const planTotal = r2(Object.values(auth).reduce((a, b) => a + b, 0));

// Columns (0-based, as docs/SPEC.md counts them): A,B empty · 2 code · 3 description · 4 provider ·
// 5 employee count · 6 vendor count · 7 units · 8 unit type · 9 frequency · 10 yearly units ·
// 11 RATE · 12 adjusted rate · 13 one-time · 14 yearly $.
const planAoa = [
  [_, _, _, _, _, _, _, _, _, _, _, 'Example Regional Center'],
  [],
  [_, _, `316 - FMS Co-Employer, $${PLAN.fms.perMonth}/Month, Vendor #:${PLAN.fms.vendor}`],
  [],
  [_, _, "Participant's Name:", _, 'UCI #', _, 'DOB', 'Service Coordinator', _, 'Provider Count', 'SP Start Date', 'SP End Date', 'Spending Plan Total', _, 'DATE PREPARED'],
  [_, _, PLAN.participant, _, PLAN.uci, _, PLAN.dob, PLAN.coordinator, 9, 7, PLAN.start, PLAN.end, planTotal, _, PLAN.prepared],
  [],
  [_, _, 'SDP SERVICE CODE', 'Description', 'Provider Name', 'Employee Count', 'Vendor Count', '# OF UNITS',
    'TYPE OF  UNITS/ FREQUENCY', 'FREQUENCY (# OF WEEKS/ MONTHS/ YEAR)', 'TOTAL YEARLY UNITS', 'RATE',
    'ADJUSTED RATE 25% (24.86% EBR + 0.14% OERC)', 'ADJUSTMENTS/ ONE-TIME FEES', 'AMOUNT PAID IN 12 MO PERIOD'],
  [],
];
let first = true;
for (const [group, totalLabel, lines] of GROUPS) {
  planAoa.push([_, _, group]);
  if (first) { // the FMS fee line: listed in the plan, paid outside the SDP budget (yearly $ 0)
    planAoa.push([_, _, '316', 'FMS Co-Employer (11+ EN)', `${PLAN.fms.name} ${PLAN.fms.vendor}`, 0, 0, 12, 'Month/Year', 1, 0, PLAN.fms.perMonth, PLAN.fms.perMonth, 0, 0]);
    first = false;
  }
  let sum = 0;
  for (const [code, description, provider, units, unit, freq, rate, oneTime] of lines) {
    const yu = units * freq, yearly = r2(yu * rate + oneTime);
    sum += yearly;
    planAoa.push([_, _, code, description, provider, _, provider.split(' or ').length, units, unit, freq, yu, rate, rate, oneTime, yearly]);
  }
  planAoa.push([_, _, _, _, _, _, _, _, _, _, totalLabel, _, _, _, r2(sum)]);
}
planAoa.push([_, _, _, _, _, _, _, _, _, _, 'Spending Plan Total', _, _, _, planTotal]);
planAoa.push([]);
planAoa.push([_, _, 'Total Certified Budget Amount', _, planTotal]);
planAoa.push([_, _, 'Total Spending Plan Amount', _, planTotal, _, _, _, 'Participant Signature', _, _, _, _, 'Date']);
planAoa.push([_, _, 'Difference', _, 0]);
planAoa.push([]);
planAoa.push([_, _, 'SDP Authorizations']);
planAoa.push([_, _, GROUPS[0][0], _, GROUPS[1][0], _, _, _, _, _, _, GROUPS[2][0]]);
planAoa.push([_, _, '320', auth['320'], '331', _, auth['331'], _, _, _, _, '358', auth['358']]);
planAoa.push([_, _, _, _, '338', _, auth['338']]);
planAoa.push([_, _, _, _, '340', _, auth['340']]);
const empTotal = r2(auth['331'] + auth['338'] + auth['340']);
planAoa.push([_, _, ' Total', auth['320'], ' Total', _, empTotal, _, _, _, _, ' Total', auth['358']]);
planAoa.push([_, _, 'SDP Authorization Total:', _, _, _, _, _, planTotal]);
planAoa.push([]);
planAoa.push([_, _, 'FMS & FTS Authorizations']);
planAoa.push([_, _, '316 - FMS', `FMS Co-Employer (11+ EN) $${PLAN.fms.perMonth}/Month`, _, PLAN.fms.perMonth * 12]);
planAoa.push([_, _, 'FMS & FTS Total:', _, _, _, _, _, PLAN.fms.perMonth * 12]);

// -------------------------------------------------------------- report ----
// ACE prints no as-of date; the latest service date is the only in-file signal.
const AS_OF = '10/01/2026';
// [code, date, type, provider, description, spent, invoice]
const TX = [
  ['320', '09/01/2026', 'Service', 'Sam Jordan', 'Personal attendant supports, September', 1500.00, '9000001'],
  ['320', '09/08/2026', 'Service', 'Morgan Lee', 'Independent living skills, cooking', 250.00, '9000003'],
  ['320', '09/15/2026', 'Service', 'Morgan Lee', 'Independent living skills, budgeting', 250.00, '9000003'],
  // quirk: invoice 9000002's community-integration line booked under SC-320 …
  ['320', '10/01/2026', 'Service', 'Casey Park', 'Community integration supports', 400.00, '9000002'],
  ['331', '09/01/2026', 'Goods Purchase', 'Example Climbing Gym', 'Community Integration Supports Membership', 100.00, '9000004'],
  ['331', '09/07/2026', 'Service', 'Casey Park', 'Community integration, library visit', 200.00, '9000005'],
  ['331', '09/14/2026', 'Service', 'Casey Park', 'Community integration, farmers market', 200.00, '9000005'],
  // … and its attendant-care line booked under SC-331.
  ['331', '10/01/2026', 'Service', 'Casey Park', 'Personal attendant supports', 600.00, '9000002'],
  ['331', '10/01/2026', 'Goods Purchase', 'Example Climbing Gym', 'Community Integration Supports Membership', 100.00, '9000004'],
  ['338', '10/01/2026', 'Goods Purchase', 'Example Transit', 'Monthly Bus Fare', 25.00, '9000004'],
  ['340', '09/01/2026', 'Service', 'Example Facilitation LLC', 'Independent facilitation, September', 500.00, '9000006'],
];
const byCode = {};
for (const c of Object.keys(auth)) byCode[c] = { spent: 0, alloc: 0, available: auth[c] };
const byProvider = {};
for (const [c, , , p, , s] of TX) {
  byCode[c].spent = r2(byCode[c].spent + s);
  byCode[c].available = r2(byCode[c].available - s);
  byProvider[p] = r2((byProvider[p] || 0) + s);
}
const spentTotal = r2(TX.reduce((a, t) => a + t[5], 0));

// Report sheet: A empty; B date/label; C type; D provider; E description; F start bal; G spent; H alloc; I avail.
const HDR = ['Starting Bal', 'Spent', 'Allocated', 'Avail Balance'];
const reportAoa = [
  [],
  [_, `${PLAN.participant} (UCI: ${PLAN.uci})\nSpending Detail Report\nYTD`],
  [],
  [_, _, _, _, _, ...HDR],
];
const catOrder = [GROUPS[0][0], GROUPS[2][0], GROUPS[1][0]]; // ACE lists Health & Safety second
const codesIn = cat => Object.keys(auth).filter(c => CATEGORY[c] === cat);
const catSum = (cat, k) => r2(codesIn(cat).reduce((a, c) => a + (k === 'auth' ? auth[c] : byCode[c][k]), 0));
for (const cat of catOrder) reportAoa.push([_, cat, _, _, _, catSum(cat, 'auth'), catSum(cat, 'spent'), 0, catSum(cat, 'available')]);
reportAoa.push([_, 'Total', _, _, _, planTotal, spentTotal, 0, r2(planTotal - spentTotal)]);
for (const cat of catOrder) {
  reportAoa.push([], [], []);
  reportAoa.push([_, cat, _, _, _, ...HDR]);
  reportAoa.push([_, _, _, _, _, catSum(cat, 'auth'), catSum(cat, 'spent'), 0, catSum(cat, 'available')]);
  for (const c of codesIn(cat)) {
    reportAoa.push([]);
    reportAoa.push([_, `SC-${c} ${CODE_NAMES[c]}`]);
    reportAoa.push([_, 'Date', 'Type', 'Provider', 'Description', ...HDR]);
    let bal = auth[c];
    reportAoa.push([_, PLAN.start, _, _, 'Spending Plan Starting Balance', bal, 0, 0, bal]);
    const rows = TX.filter(t => t[0] === c).sort((a, b) => a[1].localeCompare(b[1]));
    for (const [, d, type, p, desc, s] of rows) {
      const start = bal; bal = r2(bal - s);
      reportAoa.push([_, d, type, p, desc, start, s, 0, bal]);
    }
    reportAoa.push([_, 'Total', _, _, _, auth[c], byCode[c].spent, 0, byCode[c].available]);
    reportAoa.push([]);
  }
}

const codeOrder = ['320', '358', '331', '338', '340'];
const svcAoa = [[], [], ['Service Code', 'Total Spent', 'Total Allocated', 'Grand Total', _, 'Total Available']];
for (const c of codeOrder) svcAoa.push([Number(c), byCode[c].spent, 0, byCode[c].spent, _, byCode[c].available]);
svcAoa.push(['Total', spentTotal, 0, spentTotal, _, r2(planTotal - spentTotal)]);

const copyAoa = [['Category', 'SC', 'Date', 'Type', 'Provider', 'RC Invoice Number', 'Description', 'Spent', 'Allocated']];
for (const c of codeOrder) for (const [tc, d, type, p, desc, s, inv] of TX.filter(t => t[0] === c))
  copyAoa.push([CATEGORY[tc], Number(tc), d, type, p, Number(inv), desc, s, 0]);
copyAoa.push(['Total', _, _, _, _, _, _, spentTotal, 0]);

const provAoa = [[], [], ['Provider Name', 'Total Spent', 'Total Allocated', 'Grand Total']];
for (const [p, s] of Object.entries(byProvider)) provAoa.push([p, s, 0, s]);
provAoa.push(['Total', spentTotal, 0, spentTotal]);

// ----------------------------------------------------------------- write ----
// Fixed workbook properties so re-running produces byte-stable output (reviewable diffs).
const PROPS = { Title: 'Synthetic ACE fixture', Author: 'sdp-planner make-fixtures', CreatedDate: new Date('2026-01-01T00:00:00Z') };
function write(name, sheets) {
  const wb = XLSX.utils.book_new();
  wb.Props = PROPS;
  for (const [sheetName, aoa] of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheetName);
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: true });
  writeFileSync(join(outDir, name), buf);
  console.log(`wrote tests/fixtures/${name} (${buf.length} bytes)`);
}
write('ace-plan.xlsx', [['Sheet2', planAoa]]);
write('ace-report.xlsx', [['Report', reportAoa], ['SVC', svcAoa], ['copy', copyAoa], ['Provider Report', provAoa]]);

const expected = {
  _note: 'Synthetic. Values a correct ACE parser must recover from ace-plan.xlsx / ace-report.xlsx.',
  plan: {
    planYear: { start: '2026-09-01', end: '2027-08-31' },
    participant: { name: PLAN.participant, uci: PLAN.uci },
    fms: { vendorNumber: PLAN.fms.vendor }, // the workbook carries no separate FMS name cell
    codes: auth, total: planTotal, lineCount: planLines.length,
    lines: planLines.map(({ code, description, providers, unitsPerYear, unit, rate, yearly }) => ({ code, description, providers, unitsPerYear, unitType: unit, rate, yearly })), // unitType = raw 'TYPE OF UNITS' cell
  },
  report: {
    latestServiceDate: AS_OF, rowCount: TX.length, spentTotal, byCode, byProvider,
    swappedInvoice: { invoice: '9000002', lines: [{ code: '320', spent: 400 }, { code: '331', spent: 600 }] },
  },
};
writeFileSync(join(outDir, 'expected.json'), JSON.stringify(expected, null, 2) + '\n');
console.log('wrote tests/fixtures/expected.json');
