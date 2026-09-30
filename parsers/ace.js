/* parsers/ace.js — ACE FMS workbooks → Plan / Report (see docs/SPEC.md "Shared interface").
 *
 * Classic script: attaches to window.SDP.parsers.ace in a browser, module.exports in node.
 * Takes a SheetJS workbook ({SheetNames, Sheets}); reads cells directly, so it does not
 * need the XLSX global itself. Pure: no DOM, no network.
 *
 * Product rules encoded here:
 *  - rates are read from the plan's RATE column only; nothing is derived from yearly $.
 *  - the report's Date is the SERVICE date (kept verbatim as MM/DD/YYYY).
 *  - budget is by service code: auth comes from the plan's "SDP Authorizations" block.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') {
    window.SDP = window.SDP || {};
    window.SDP.parsers = window.SDP.parsers || {};
    window.SDP.parsers.ace = api;
  }
})(this, function () {
  'use strict';

  // ---------- sheet helpers (no XLSX dependency) ----------
  function colIndex(letters) {
    var n = 0;
    for (var i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
    return n - 1;
  }
  /** Sheet → dense 2-D array of cell values (null where empty). Row/col indices are 0-based sheet positions. */
  function grid(ws) {
    var out = [];
    if (!ws) return out;
    Object.keys(ws).forEach(function (addr) {
      var m = /^([A-Z]+)(\d+)$/.exec(addr);
      if (!m) return;
      var cell = ws[addr], r = +m[2] - 1, c = colIndex(m[1]);
      var v = cell && cell.v !== undefined ? cell.v : null;
      if (cell && cell.t === 'd' && !(v instanceof Date)) v = new Date(v);
      if (cell && cell.t === 'n' && isDateFormat(cell.z)) v = serialToDate(v);
      if (typeof v === 'string' && v.trim() === '') v = null;
      (out[r] = out[r] || [])[c] = v;
    });
    for (var i = 0; i < out.length; i++) {
      out[i] = out[i] || [];
      for (var j = 0; j < out[i].length; j++) if (out[i][j] === undefined) out[i][j] = null;
    }
    return out;
  }
  function isDateFormat(z) { return typeof z === 'string' && /[dmy]{1,4}[\/\-.][dmy]{1,4}/i.test(z); }
  function serialToDate(n) { return new Date(Math.round((n - 25569) * 864e5)); } // Excel 1900 epoch, UTC
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function str(v) { return v === null || v === undefined ? '' : String(v).trim(); }
  function num(v) {
    if (typeof v === 'number') return v;
    if (typeof v === 'string') { var s = v.replace(/[$,\s]/g, ''); if (s !== '' && !isNaN(+s)) return +s; }
    return null;
  }
  function money(v) { var n = num(v); return n === null ? 0 : n; }
  function cents(x) { return Math.round(x * 100) / 100; }
  /** Any date-ish cell → 'MM/DD/YYYY' or null. */
  function mdy(v) {
    if (v instanceof Date && !isNaN(v)) return pad(v.getUTCMonth() + 1) + '/' + pad(v.getUTCDate()) + '/' + v.getUTCFullYear();
    if (typeof v === 'number' && v > 20000 && v < 80000) return mdy(serialToDate(v));
    var s = str(v), m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
    if (m) return pad(+m[1]) + '/' + pad(+m[2]) + '/' + m[3];
    m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (m) return m[2] + '/' + m[3] + '/' + m[1];
    return null;
  }
  function isoFromMdy(d) { return d ? d.slice(6) + '-' + d.slice(0, 2) + '-' + d.slice(3, 5) : null; }
  function findCell(g, pred, maxRows) {
    for (var r = 0; r < Math.min(g.length, maxRows || g.length); r++)
      for (var c = 0; c < g[r].length; c++) if (pred(g[r][c])) return { r: r, c: c };
    return null;
  }
  function norm(v) { return str(v).toUpperCase().replace(/\s+/g, ' '); }
  function sheetNamed(wb, name) {
    var hit = (wb.SheetNames || []).filter(function (n) { return n.trim().toLowerCase() === name.toLowerCase(); })[0];
    return hit ? wb.Sheets[hit] : null;
  }

  // ---------- detection ----------
  function isPlan(wb) {
    return (wb.SheetNames || []).some(function (n) {
      var g = grid(wb.Sheets[n]);
      return !!findCell(g, function (v) { return norm(v) === 'SDP SERVICE CODE'; }, 80);
    });
  }
  function isReport(wb) {
    var rep = sheetNamed(wb, 'Report');
    if (!rep) return false;
    if (sheetNamed(wb, 'SVC')) return true;
    return !!findCell(grid(rep), function (v) { return /^SC-\d{3}\b/.test(str(v)); }, 200);
  }

  // Public DDS SDP service-code names (fallbacks when a file does not name the code).
  var CODE_NAMES = {
    '310': 'Participant-Directed Goods and Services', '317': 'Financial Management Services',
    '320': 'Community Living Supports', '321': 'Supported Living Services',
    '331': 'Community Integration Supports', '338': 'Non-Medical Transportation',
    '340': 'Independent Facilitator', '358': 'Personal Emergency Response Systems'
  };
  function isFmsLine(code, desc) { return /\bFMS\b|Financial Management/i.test(desc) || code === '315' || code === '316' || code === '317'; }
  function splitProviders(s) { return str(s).split(/\s+or\s+|\s*\/\s*|\s*;\s*/i).map(str).filter(Boolean); }
  function unitOf(s) { var u = str(s).split('/')[0].trim().toLowerCase(); return u || 'unit'; }

  // ---------- plan workbook ----------
  var PLAN_COLS = [ // header text (prefix, normalized) → field; offsets from the code column as a fallback
    ['SDP SERVICE CODE', 'code', 0], ['DESCRIPTION', 'description', 1], ['PROVIDER NAME', 'provider', 2],
    ['# OF UNITS', 'units', 5], ['TYPE OF', 'unitType', 6], ['FREQUENCY', 'frequency', 7],
    ['TOTAL YEARLY UNITS', 'unitsPerYear', 8], ['RATE', 'rate', 9], ['ADJUSTED RATE', 'adjustedRate', 10],
    ['ADJUSTMENTS', 'oneTime', 11], ['AMOUNT PAID', 'yearly', 12]
  ];

  function plan(wb) {
    var name = (wb.SheetNames || []).filter(function (n) {
      return !!findCell(grid(wb.Sheets[n]), function (v) { return norm(v) === 'SDP SERVICE CODE'; }, 80);
    })[0];
    if (!name) throw new Error('ACE plan: no sheet has an "SDP SERVICE CODE" header');
    var g = grid(wb.Sheets[name]);
    var hdr = findCell(g, function (v) { return norm(v) === 'SDP SERVICE CODE'; });

    // Map header columns by text, falling back to the ACE offsets.
    var col = {}, hrow = g[hdr.r];
    PLAN_COLS.forEach(function (spec) {
      var at = -1;
      for (var c = hdr.c; c < hrow.length; c++) {
        var h = norm(hrow[c]);
        if (spec[0] === 'RATE' ? h === 'RATE' : h.indexOf(spec[0]) === 0) { at = c; break; }
      }
      col[spec[1]] = at >= 0 ? at : hdr.c + spec[2];
    });

    // Participant block: a label row ("Participant's Name:", "UCI #", ...) with values on the next row.
    var participant = {}, coordinator, planYear = {}, stated = null;
    var pcell = findCell(g, function (v) { return /^PARTICIPANT'?S NAME/.test(norm(v)); });
    if (pcell) {
      var labels = g[pcell.r], vals = g[pcell.r + 1] || [];
      labels.forEach(function (lab, c) {
        var L = norm(lab), v = vals[c];
        if (v === null || v === undefined) return;
        if (/^PARTICIPANT'?S NAME/.test(L)) participant.name = str(v);
        else if (/^UCI/.test(L)) participant.uci = str(v);
        else if (/^SERVICE COORDINATOR/.test(L)) coordinator = str(v);
        else if (/^SP START/.test(L)) planYear.start = isoFromMdy(mdy(v));
        else if (/^SP END/.test(L)) planYear.end = isoFromMdy(mdy(v));
        else if (/^SPENDING PLAN TOTAL/.test(L)) stated = num(v);
        // DOB is deliberately not read: the tool never needs it.
      });
    }

    // FMS header: "316 - FMS Co-Employer, $800/Month, Vendor #:ZZ0000"
    var fms = { name: 'ACE' };
    var fcell = findCell(g, function (v) { return /^\d{3}\s*-\s*FMS/i.test(str(v)); }, hdr.r + 1);
    if (fcell) {
      var s = str(g[fcell.r][fcell.c]);
      var m = /^(\d{3})\s*-\s*FMS\s*([^,]*)/i.exec(s);
      if (m) { fms.code = m[1]; fms.model = str(m[2]) || undefined; }
      var fee = /\$([\d,.]+)\s*\/\s*Month/i.exec(s); if (fee) fms.monthlyFee = num(fee[1]);
      var vend = /Vendor\s*#\s*:?\s*([A-Za-z0-9]+)/i.exec(s); if (vend) fms.vendorNumber = vend[1];
    }

    // Lines + category groups.
    var lines = [], codes = {}, category = null;
    for (var r = hdr.r + 1; r < g.length; r++) {
      var row = g[r], first = str(row[col.code]);
      if (/^TOTAL CERTIFIED|^SDP AUTHORIZATIONS/i.test(first)) break;
      if (/\(\d{3}\s*-\s*\d{3}\)/.test(first)) { category = first; continue; }
      var code = num(row[col.code]);
      if (code === null || code < 300 || code > 399) continue;
      code = String(Math.round(code));
      var desc = str(row[col.description]);
      if (isFmsLine(code, desc)) continue; // FMS fee is paid by the RC outside the SDP budget
      var rate = num(row[col.rate]);
      var line = {
        code: code, description: desc,
        providers: splitProviders(row[col.provider]), providerText: str(row[col.provider]),
        units: num(row[col.units]), unitType: str(row[col.unitType]),
        frequency: num(row[col.frequency]),
        unitsPerYear: num(row[col.unitsPerYear]), unit: unitOf(row[col.unitType]),
        rate: rate, adjustedRate: num(row[col.adjustedRate]),
        oneTime: money(row[col.oneTime]), yearly: cents(money(row[col.yearly]))
      };
      lines.push(line);
      if (!codes[code]) codes[code] = { name: CODE_NAMES[code] || desc, auth: 0, category: category || undefined };
    }

    // Authorizations: after "SDP Authorizations", read (code, next number to its right) pairs.
    var auth = {}, acell = findCell(g, function (v) { return /^SDP AUTHORIZATIONS$/i.test(str(v)); });
    if (acell) {
      for (var ar = acell.r + 1; ar < g.length; ar++) {
        var arow = g[ar];
        if (arow.some(function (v) { return /AUTHORIZATION TOTAL/i.test(str(v)); })) break;
        for (var c = 0; c < arow.length; c++) {
          var cv = arow[c];
          if (typeof cv !== 'number' || cv !== Math.round(cv) || cv < 300 || cv > 399) continue;
          for (var k = c + 1; k < arow.length; k++) {
            if (arow[k] === null) continue;
            var amt = num(arow[k]);
            if (amt !== null) { auth[String(cv)] = amt; c = k; }
            break;
          }
        }
      }
    }
    var sumByCode = {};
    lines.forEach(function (L) { sumByCode[L.code] = cents((sumByCode[L.code] || 0) + L.yearly); });
    Object.keys(sumByCode).forEach(function (c) { codes[c].auth = auth[c] !== undefined ? auth[c] : sumByCode[c]; });
    Object.keys(auth).forEach(function (c) { if (!codes[c]) codes[c] = { name: CODE_NAMES[c] || ('SC-' + c), auth: auth[c] }; });

    var total = cents(Object.keys(codes).reduce(function (s, c) { return s + codes[c].auth; }, 0));
    return {
      source: 'ace-plan',
      planYear: planYear, participant: participant, coordinator: coordinator, fms: fms,
      codes: codes, lines: lines, total: stated !== null ? cents(stated) : total,
      checks: { authFromSheet: Object.keys(auth).length > 0, linesTotal: cents(lines.reduce(function (s, L) { return s + L.yearly; }, 0)), authTotal: total }
    };
  }

  // ---------- YTD report workbook ----------
  function report(wb) {
    var ws = sheetNamed(wb, 'Report');
    if (!ws) throw new Error('ACE report: no "Report" sheet');
    var g = grid(ws);

    var participant = {};
    var tcell = findCell(g, function (v) { return /\(UCI:\s*\d+\)/i.test(str(v)); }, 12);
    if (tcell) {
      var tm = /^(.*?)\s*\(UCI:\s*(\d+)\)/i.exec(str(g[tcell.r][tcell.c]));
      participant = { name: str(tm[1]), uci: tm[2] };
    }

    // Column map from the first "Date | Type | Provider | ..." header; ACE default offsets otherwise.
    var C = { date: 1, type: 2, provider: 3, description: 4, start: 5, spent: 6, alloc: 7, avail: 8 };
    var h = findCell(g, function (v) { return norm(v) === 'DATE'; });
    if (h) {
      var hr = g[h.r];
      hr.forEach(function (v, c) {
        var n = norm(v);
        if (n === 'DATE') C.date = c; else if (n === 'TYPE') C.type = c; else if (n === 'PROVIDER') C.provider = c;
        else if (n === 'DESCRIPTION') C.description = c; else if (/^STARTING/.test(n)) C.start = c;
        else if (n === 'SPENT') C.spent = c; else if (/^ALLOC/.test(n)) C.alloc = c; else if (/^AVAIL/.test(n)) C.avail = c;
      });
    }

    var rows = [], start = {}, names = {}, code = null, planStart = null;
    g.forEach(function (row) {
      var label = str(row[C.date]);
      var sc = /^SC-(\d{3})\s*(.*)$/.exec(label);
      if (sc) { code = sc[1]; names[code] = str(sc[2]); return; }
      var d = mdy(row[C.date]);
      if (!d || !code) return;
      var desc = str(row[C.description]), type = str(row[C.type]);
      if (/STARTING BALANCE/i.test(desc) && !type) {
        start[code] = money(row[C.start]);
        if (!planStart || isoFromMdy(d) < planStart) planStart = isoFromMdy(d);
        return;
      }
      if (!type) return;
      var spent = money(row[C.spent]), alloc = money(row[C.alloc]);
      if (spent === 0 && alloc === 0) return;
      rows.push({ date: d, month: d.slice(6) + '-' + d.slice(0, 2), type: type, provider: str(row[C.provider]),
                  code: code, description: desc, spent: spent, alloc: alloc });
    });

    // Invoice numbers live only on the "copy" sheet; attach by (code, date, provider, spent).
    var copy = sheetNamed(wb, 'copy');
    if (copy) {
      var cg = grid(copy), ch = findCell(cg, function (v) { return norm(v) === 'SC'; }, 10), inv = {};
      if (ch) {
        var cmap = {};
        cg[ch.r].forEach(function (v, c) { cmap[norm(v)] = c; });
        var ic = Object.keys(cmap).filter(function (k) { return /INVOICE/.test(k); })[0];
        for (var r = ch.r + 1; r < cg.length && ic; r++) {
          var cr = cg[r], cc = num(cr[cmap.SC]);
          if (cc === null) continue;
          var key = [String(cc), mdy(cr[cmap.DATE]), str(cr[cmap.PROVIDER]), cents(money(cr[cmap.SPENT]))].join('|');
          (inv[key] = inv[key] || []).push(str(cr[cmap[ic]]));
        }
        rows.forEach(function (R) {
          var q = inv[[R.code, R.date, R.provider, cents(R.spent)].join('|')];
          if (q && q.length) R.invoice = q.shift();
        });
      }
    }

    // Totals from the ledger rows.
    var byCode = {}, byProvider = {};
    Object.keys(start).forEach(function (c) { byCode[c] = { spent: 0, alloc: 0, available: start[c], start: start[c], name: names[c] }; });
    rows.forEach(function (R) {
      var b = byCode[R.code] = byCode[R.code] || { spent: 0, alloc: 0, available: 0, start: 0, name: names[R.code] };
      b.spent = cents(b.spent + R.spent); b.alloc = cents(b.alloc + R.alloc);
      byProvider[R.provider] = cents((byProvider[R.provider] || 0) + R.spent + R.alloc);
    });
    Object.keys(byCode).forEach(function (c) { var b = byCode[c]; b.available = cents(b.start - b.spent - b.alloc); });

    // Cross-check against the report's own SVC and Provider Report sheets (to the cent).
    var mismatches = [], svc = sheetNamed(wb, 'SVC'), prov = sheetNamed(wb, 'Provider Report');
    if (svc) {
      grid(svc).forEach(function (r) {
        var c = num(r[0]);
        if (c === null || c < 300 || c > 399) return;
        c = String(c);
        var sheet = { spent: money(r[1]), alloc: money(r[2]), available: money(r[5]) };
        var mine = byCode[c] || { spent: 0, alloc: 0, available: 0 };
        ['spent', 'alloc', 'available'].forEach(function (k) {
          if (Math.abs(mine[k] - sheet[k]) >= 0.005) mismatches.push({ sheet: 'SVC', code: c, field: k, ledger: mine[k], report: sheet[k] });
        });
      });
    }
    if (prov) {
      grid(prov).forEach(function (r) {
        var p = str(r[0]);
        if (!p || /^(PROVIDER NAME|TOTAL)$/i.test(p) || num(r[3]) === null) return;
        var mine = byProvider[p] || 0;
        if (Math.abs(mine - money(r[3])) >= 0.005) mismatches.push({ sheet: 'Provider Report', provider: p, ledger: mine, report: money(r[3]) });
      });
    }

    var last = rows.reduce(function (m, R) { var i = isoFromMdy(R.date); return i > m ? i : m; }, planStart || '');
    return {
      source: 'ace-report',
      asOf: last || null, planStart: planStart, participant: participant,
      rows: rows, byCode: byCode, byProvider: byProvider,
      checks: { ok: mismatches.length === 0, mismatches: mismatches, crossChecked: !!(svc || prov) }
    };
  }

  /** Registry contract (docs/ADDING-AN-FMS.md): 'plan' | 'report' | null. Report first: a report never has "SDP SERVICE CODE". */
  function detect(wb) {
    if (!wb || !wb.SheetNames) return null;
    return isReport(wb) ? 'report' : isPlan(wb) ? 'plan' : null;
  }

  return { id: 'ace', label: 'ACE Financial Services', detect: detect, plan: plan, report: report,
           isPlan: isPlan, isReport: isReport, _grid: grid, _mdy: mdy };
});
