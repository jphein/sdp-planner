// In-memory ACE-layout workbooks for unit tests. All data is invented.
// Layouts mirror the real ACE files cell-for-cell (column positions, label text, section rows).
const XLSX = require('../../vendor/xlsx.full.min.js');

function book(sheets) {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  // Round-trip through bytes so tests see exactly what a browser upload would.
  return XLSX.read(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}
const _ = null;

function planWorkbook() {
  const hdr = [_, _, 'SDP SERVICE CODE', 'Description', 'Provider Name', 'Employee Count', 'Vendor Count', '# OF UNITS',
    'TYPE OF  UNITS/ FREQUENCY', 'FREQUENCY (# OF WEEKS/ MONTHS/ YEAR)', 'TOTAL YEARLY UNITS', 'RATE',
    'ADJUSTED RATE 25% (24.86% EBR + 0.14% OERC)', 'ADJUSTMENTS/ ONE-TIME FEES', 'AMOUNT PAID IN 12 MO PERIOD'];
  const L = (code, desc, prov, units, type, freq, yu, rate, yearly) => [_, _, code, desc, prov, _, 1, units, type, freq, yu, rate, rate, 0, yearly];
  const aoa = [
    [_, _, _, _, _, _, _, _, _, _, _, 'Example Regional Center'],
    [],
    [_, _, '316 - FMS Co-Employer, $800/Month, Vendor #:ZZ0000'],
    [],
    [_, _, "Participant's Name:", _, 'UCI #', _, 'DOB', 'Service Coordinator', _, 'Provider Count', 'SP Start Date', 'SP End Date', 'Spending Plan Total', _, 'DATE PREPARED'],
    [_, _, 'Riley Sample', _, 0, _, '01/01/2000', 'Pat Example', _, 6, '09/01/2026', '08/31/2027', 55420, _, '07/01/2026'],
    [],
    hdr,
    [],
    [_, _, 'Living Arrangement (310-321)'],
    [_, _, 316, 'FMS Co-Employer (11+ EN)', 'Example FMS ZZ0000', 0, 0, 12, 'Month/Year', 1, 0, 800, 800, 0, 0],
    L(320, 'Personal Attendent supports', 'Alex Rivera or Sam Okafor', 50, 'Hour/Month', 12, 600, 35, 21000),
    L(320, 'ILS', 'Sam Okafor', 10, 'Hour/Month', 12, 120, 50, 6000),
    [_, _, _, _, _, _, _, _, _, _, 'Living Arrangement  Total', _, _, _, 27000],
    [_, _, 'Employment & Community Participation (331-340)'],
    L(331, 'Community Integration Supports - TDS', 'Jordan Lee or Morgan Blake', 52, 'Week/Year', 1, 52, 200, 10400),
    L(331, 'Community Integration Supports - TDS', 'Priya Natarajan', 26, 'Week/Year', 1, 26, 200, 5200),
    L(338, 'Non-Medical Transportation', 'Example Transit', 12, 'Month/Year', 1, 12, 25, 300),
    L(340, 'Independent Facilitator', 'Example Facilitation LLC', 12, 'Month/Year', 1, 12, 450, 5400),
    L(331, 'Climbing Gym Membership', 'Example Climbing', 12, 'Month/Year', 1, 12, 80, 960),
    L(331, 'Community Integration Supports', 'Example Media Studio', 40, 'Unit/Year', 1, 40, 60, 2400),
    [_, _, _, _, _, _, _, _, _, _, 'Employment & Community Participation  Total', _, _, _, 24660],
    [_, _, 'Health & Safety (356-377)'],
    L(358, 'Medical Alert Annual Membership', 'Example Alert', 1, 'Year/Year', 1, 1, 60, 60),
    [_, _, _, _, _, _, _, _, _, _, 'Health & Safety  Total', _, _, _, 60],
    [_, _, _, _, _, _, _, _, _, _, 'Spending Plan Total', _, _, _, 51720],
    [],
    [_, _, 'Total Certified Budget Amount', _, 55420],
    [_, _, 'Total Spending Plan Amount', _, 55420, _, _, _, 'Participant Signature', _, _, _, _, 'Date'],
    [],
    [_, _, 'SDP Authorizations'],
    [_, _, 'Living Arrangement (310-321)', _, 'Employment & Community Participation (331-340)', _, _, _, _, _, _, 'Health & Safety (356-377)'],
    // 331 auth deliberately differs from its line sum (an amended plan) to prove auth comes from this block.
    [_, _, 320, 27000, 331, _, 22620, _, _, _, _, 358, 60],
    [_, _, _, _, 338, _, 340],   // 338's authorization is $340 — a code-shaped amount must not be read as a code
    [_, _, _, _, 340, _, 5400],
    [_, _, ' Total', 27000, ' Total', _, 28360, _, _, _, _, ' Total', 60],
    [_, _, 'SDP Authorization Total:', _, _, _, _, _, 55420],
    [],
    [_, _, 'FMS & FTS Authorizations'],
    [_, _, '316 - FMS', 'FMS Co-Employer (11+ EN) $800 (12 Month x $800 )', _, 9600]
  ];
  return book([['Sheet2', aoa]]);
}

// Report rows per code: [date, type, provider, description, spent, alloc, invoice]
const REPORT_ROWS = {
  320: [['09/01/2026', 'Service', 'Alex Rivera', 'Personal attendant support', 1750, 0, 'INV-1'],
        ['09/08/2026', 'Service', 'Sam Okafor', 'Independent living skills', 250, 0, 'INV-2'],
        ['10/01/2026', 'Service', 'Alex Rivera', 'Personal attendant support', 0, 1680, 'INV-3']],
  331: [['09/01/2026', 'Goods Purchase', 'Example Climbing Gym', 'Monthly membership', 240, 0, 'INV-4'],
        ['09/03/2026', 'Service', 'Jordan Lee', 'Community outing', 190, 0, 'INV-2'],
        ['09/10/2026', 'Service', 'Jordan Lee', 'Community outing', 190, 0, 'INV-2'],
        ['09/17/2026', 'Service', 'Priya Natarajan', 'Community outing', 152.5, 0, 'INV-5'],
        ['09/20/2026', 'Service', 'Priya Natarajan', 'Refund adjustment', -20, 0, 'INV-6']],
  338: [['10/01/2026', 'Goods Purchase', 'Example Transit', 'Monthly bus pass', 75, 0, 'INV-4']],
  340: [],
  358: []
};
const NAMES = { 320: 'Community Living Supports', 331: 'Community Integration Supports', 338: 'Non-Medical Transportation', 340: 'Independent Facilitator', 358: 'Personal Emergency Response Systems (PERS) ' };
const AUTH = { 320: 27000, 331: 22620, 338: 340, 340: 5400, 358: 60 };
const CATEGORY = { 320: 'Living Arrangement (310-321)', 331: 'Employment & Community Participation (331-340)', 338: 'Employment & Community Participation (331-340)', 340: 'Employment & Community Participation (331-340)', 358: 'Health & Safety (356-377)' };

function reportWorkbook({ tamperSvc = false, dateSerials = false } = {}) {
  const sum = (rs, i) => rs.reduce((s, r) => s + r[i], 0);
  const rep = [[], [_, 'Riley Sample (UCI: 0000000)\nSpending Detail Report\nYTD'], [], [_, _, _, _, _, 'Starting Bal', 'Spent', 'Allocated', 'Avail Balance']];
  const XL = d => { const [m, dd, y] = d.split('/').map(Number); return (Date.UTC(y, m - 1, dd) / 864e5) + 25569; };
  for (const code of [320, 358, 331, 338, 340]) {
    const rs = REPORT_ROWS[code];
    rep.push([], [_, CATEGORY[code], _, _, _, 'Starting Bal', 'Spent', 'Allocated', 'Avail Balance']);
    rep.push([], [_, `SC-${code} ${NAMES[code]}`], [_, 'Date', 'Type', 'Provider', 'Description', 'Starting Bal', 'Spent', 'Allocated', 'Avail Balance']);
    rep.push([_, '09/01/2026', _, _, 'Spending Plan Starting Balance', AUTH[code], 0, 0, AUTH[code]]);
    let bal = AUTH[code];
    for (const r of rs) {
      const nb = bal - r[4] - r[5];
      rep.push([_, dateSerials ? XL(r[0]) : r[0], r[1], r[2], r[3], bal, r[4], r[5], nb]); bal = nb;
    }
    rep.push([_, 'Total', _, _, _, AUTH[code], sum(rs, 4), sum(rs, 5), bal]);
  }
  const svc = [[], [], ['Service Code', 'Total Spent', 'Total Allocated', 'Grand Total', _, 'Total Available']];
  for (const code of [320, 358, 331, 338, 340]) {
    const rs = REPORT_ROWS[code], sp = sum(rs, 4) + (tamperSvc && code === 331 ? 1 : 0), al = sum(rs, 5);
    svc.push([code, sp, al, sp + al, _, AUTH[code] - sum(rs, 4) - al]);
  }
  const copy = [['Category', 'SC', 'Date', 'Type', 'Provider', 'RC Invoice Number', 'Description', 'Spent', 'Allocated']];
  const prov = {};
  for (const code of [320, 331, 338]) for (const r of REPORT_ROWS[code]) {
    copy.push([CATEGORY[code], code, r[0], r[1], r[2], r[6], r[3], r[4], r[5]]);
    prov[r[2]] = (prov[r[2]] || 0) + r[4] + r[5];
  }
  const pr = [[], [], ['Provider Name', 'Total Spent', 'Total Allocated', 'Grand Total']];
  for (const [p, v] of Object.entries(prov)) pr.push([p, v, 0, v]);
  pr.push(['Total', 0, 0, 0]);
  const sheets = [['Report', rep], ['SVC', svc], ['copy', copy], ['Provider Report', pr]];
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    if (dateSerials) for (const k of Object.keys(ws)) if (/^B\d+$/.test(k) && ws[k].t === 'n' && ws[k].v > 40000) ws[k].z = 'mm/dd/yyyy';
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  return XLSX.read(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

module.exports = { XLSX, planWorkbook, reportWorkbook, REPORT_ROWS, AUTH };
