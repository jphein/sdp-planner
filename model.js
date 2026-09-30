/* model.js — pure SDP budget logic (no DOM). See docs/SPEC.md "Shared interface" + "Product rules".
 *
 * Classic script: attaches to window.SDP.model in a browser, module.exports in node.
 *
 * Rules this file encodes:
 *  1. Budget is by SERVICE CODE. No per-person caps; money never moves between codes;
 *     anything unspent in a code at plan-year end is FORFEIT (it does not carry over).
 *  2. A report row's date is the SERVICE date; rows post ~1 month in arrears, so pace counts
 *     only months that could have posted (a month is "elapsed" once the next one has begun).
 *  3. Rates come from the plan's RATE column (or from the user). Nothing here infers a rate
 *     from yearly dollars; a weekly/monthly plan line without an hourly rate stays a fixed $ line.
 *
 * Line = { id, provider, code, service, rate, hours, start:'YYYY-MM', fixed:bool, note?, ... }
 *        yearly $ = fixed ? rate : hours * rate   (hours = hours over the plan year from `start`)
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') {
    window.SDP = window.SDP || {};
    window.SDP.model = api;
  }
})(this, function () {
  'use strict';

  var EPS = 0.005; // half a cent
  function cents(x) { return Math.round((x + (x >= 0 ? 1e-9 : -1e-9)) * 100) / 100; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  // ---------- dates (all UTC: no DST drift in day counts) ----------
  function ymd(s) { // 'YYYY-MM-DD' | 'YYYY-MM' | 'MM/DD/YYYY' | Date → UTC ms
    if (s instanceof Date) return Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate());
    var m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(s);
    if (m) return Date.UTC(+m[1], +m[2] - 1, m[3] ? +m[3] : 1);
    m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
    if (m) return Date.UTC(+m[3], +m[1] - 1, +m[2]);
    throw new Error('bad date: ' + s);
  }
  function ym(t) { var d = new Date(t); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1); }
  function yearEndOf(x) { return typeof x === 'string' ? x : (x && x.planYear ? x.planYear.end : x && x.end); }
  function yearStartOf(x) { return typeof x === 'string' ? x : (x && x.planYear ? x.planYear.start : x && x.start); }
  function monthIndex(s) { var t = new Date(ymd(s)); return t.getUTCFullYear() * 12 + t.getUTCMonth(); }

  /** Weeks from the 1st of `ymStart` through `yearEnd` inclusive (fractional). Never below 1, so hr/wk is always defined. */
  function weeksFrom(ymStart, yearEnd) {
    var days = (ymd(yearEndOf(yearEnd)) - ymd(ymStart)) / 864e5 + 1;
    return Math.max(1, days / 7);
  }
  /** Whole months from `ymStart` through the month of `yearEnd` inclusive. Never below 1. */
  function monthsFrom(ymStart, yearEnd) {
    return Math.max(1, monthIndex(yearEndOf(yearEnd)) - monthIndex(ymStart) + 1);
  }
  /** ['YYYY-MM', ...] for every month of the plan year. */
  function planMonths(planYear) {
    var out = [], a = monthIndex(yearStartOf(planYear)), b = monthIndex(yearEndOf(planYear));
    for (var i = a; i <= b; i++) out.push(Math.floor(i / 12) + '-' + pad(i % 12 + 1));
    return out;
  }

  // ---------- lines ----------
  function yearly(L) { return cents(L.fixed ? (+L.rate || 0) : (+L.hours || 0) * (+L.rate || 0)); }
  function hoursPerWeek(L, yearEnd) { return L.fixed ? null : (+L.hours || 0) / weeksFrom(L.start, yearEnd); }
  function hoursPerMonth(L, yearEnd) { return L.fixed ? null : (+L.hours || 0) / monthsFrom(L.start, yearEnd); }

  var SERVICE_ABBR = [[/personal att/i, 'PA'], [/\bILS\b|independent living/i, 'ILS'], [/\bTDS\b|tailored day/i, 'TDS'],
                      [/transport/i, 'Transport'], [/facilitat/i, 'IF'], [/\bPERS\b|medic ?alert|emergency response/i, 'PERS'], [/membership/i, 'Membership']];
  function serviceLabel(desc) {
    for (var i = 0; i < SERVICE_ABBR.length; i++) if (SERVICE_ABBR[i][0].test(desc || '')) return SERVICE_ABBR[i][1];
    return desc || 'Service';
  }
  function rateFor(rates, code, service) {
    if (!rates) return null;
    var v = rates[code + ':' + service];
    if (v === undefined) v = rates[code];
    return v === undefined || v === null || isNaN(+v) ? null : +v;
  }
  function samePerson(a, b) {
    a = (a || '').trim().toLowerCase(); b = (b || '').trim().toLowerCase();
    return !!a && !!b && (a === b || a.indexOf(b) === 0 || b.indexOf(a) === 0);
  }
  /** Report $ (spent + allocated) for a provider in a code; exact name, else prefix match either way. */
  function billed(report, provider, code) {
    if (!report || !report.rows) return 0;
    var exact = 0, fuzzy = 0, hasExact = false;
    report.rows.forEach(function (R) {
      if (String(R.code) !== String(code)) return;
      var v = (R.spent || 0) + (R.alloc || 0);
      if (R.provider === provider) { exact += v; hasExact = true; } else if (samePerson(R.provider, provider)) fuzzy += v;
    });
    return cents(hasExact ? exact : fuzzy);
  }

  /**
   * Default proposal from the plan: one Line per plan line, primary provider first.
   * @param plan    Plan
   * @param report  optional LAST YEAR's Report — annotates each line with `lastYear` $ billed;
   *                with opts.basis==='lastYear' and a last-year hourly rate in opts.lastYearRates,
   *                hours become last year's $ / last year's rate ("last year's hours at this year's rates").
   * @param opts    { start:'YYYY-MM' (default plan start), rates:{code|'code:service': $/hr} for
   *                  non-hourly plan lines, basis:'plan'|'lastYear', lastYearRates:{...} }
   */
  function buildProposal(plan, report, opts) {
    opts = opts || {};
    var start = opts.start || ym(ymd(plan.planYear.start));
    var primaries = {}; // code → {provider: true} for providers named first on some line
    (plan.lines || []).forEach(function (P) {
      var p = (P.providers && P.providers[0]) || P.providerText;
      (primaries[P.code] = primaries[P.code] || {})[p] = true;
    });
    return (plan.lines || []).map(function (P, i) {
      var service = serviceLabel(P.description);
      var provider = (P.providers && P.providers[0]) || P.providerText || 'Provider ' + (i + 1);
      var L = { id: 'L' + (i + 1) + '-' + P.code, provider: provider, code: String(P.code), service: service,
                start: start, planLine: i, planYearly: P.yearly, alternates: (P.providers || []).slice(1) };
      var hourly = /^h(ou)?r/i.test(P.unit || '') && P.rate > 0;
      // A user-supplied hourly rate converts only staffed-time budget lines (per week/day); monthly,
      // per-unit and yearly lines are memberships/goods and stay fixed dollars.
      var userRate = /^(week|wk|day)/i.test(P.unit || '') ? rateFor(opts.rates, L.code, service) : null;
      if (hourly) {
        L.fixed = false; L.rate = P.rate; L.hours = P.unitsPerYear || 0;
      } else if (userRate) {
        L.fixed = false; L.rate = userRate; L.hours = P.yearly / userRate;
        L.note = 'plan line ' + (P.unitsPerYear || '') + ' ' + (P.unit || 'unit') + ' × $' + (P.rate || 0).toFixed(2) + '; hours at your $' + userRate.toFixed(2) + '/hr';
      } else {
        L.fixed = true; L.rate = P.yearly; L.hours = 0;
        L.note = 'plan budgets ' + (P.unitsPerYear || '') + ' ' + (P.unit || 'unit') + ' × $' + (P.rate || 0).toFixed(2) + ' = $' + P.yearly.toFixed(2) + '/yr';
      }
      if (report) {
        // Primary + alternates, except an alternate who is primary on another line in this code
        // (their billing belongs to that line — never count a dollar twice).
        var ly = billed(report, provider, L.code);
        L.alternates.forEach(function (p) { if (!primaries[P.code][p]) ly += billed(report, p, L.code); });
        L.lastYear = cents(ly);
        var lyRate = rateFor(opts.lastYearRates, L.code, service);
        if (opts.basis === 'lastYear' && !L.fixed && lyRate) {
          L.hours = ly / lyRate;
          L.note = 'last year $' + ly.toFixed(2) + ' ÷ $' + lyRate.toFixed(2) + '/hr';
        }
      }
      return L;
    });
  }

  function authOf(x) { // {code:number} | Plan | plan.codes → {code:number}
    var src = x && x.codes ? x.codes : x || {}, out = {};
    Object.keys(src).forEach(function (c) { var v = src[c]; out[c] = typeof v === 'number' ? v : +(v && v.auth) || 0; });
    return out;
  }

  /**
   * Year-end forecast of a proposal against the authorizations, by code.
   * headroom = auth − proposal. Positive headroom is FORFEIT at year end unless spent in that code;
   * negative headroom in any code means the proposal does not fit (it cannot borrow from another code).
   */
  function forecast(lines, auth) {
    var A = authOf(auth), byCode = {};
    Object.keys(A).forEach(function (c) { byCode[c] = { auth: A[c], proposal: 0 }; });
    (lines || []).forEach(function (L) {
      var c = String(L.code), b = byCode[c] = byCode[c] || { auth: 0, proposal: 0 };
      b.proposal = cents(b.proposal + yearly(L));
    });
    var overCodes = [], T = { auth: 0, proposal: 0, headroom: 0, forfeit: 0, over: 0 };
    Object.keys(byCode).sort().forEach(function (c) {
      var b = byCode[c];
      b.headroom = cents(b.auth - b.proposal);
      b.forfeit = b.headroom > EPS ? b.headroom : 0;
      b.over = b.headroom < -EPS ? -b.headroom : 0;
      b.fits = b.headroom >= -EPS;
      if (!b.fits) overCodes.push(c);
      T.auth += b.auth; T.proposal += b.proposal; T.forfeit += b.forfeit; T.over += b.over;
    });
    Object.keys(T).forEach(function (k) { T[k] = cents(T[k]); });
    T.headroom = cents(T.auth - T.proposal);
    return { byCode: byCode, total: T.proposal, totals: T, fits: overCodes.length === 0, overCodes: overCodes };
  }

  /** The hours (or fixed $) that make `line` use exactly what is left in its code. Never negative. */
  function fill(line, lines, auth) {
    var f = forecast(lines, auth), b = f.byCode[String(line.code)] || { headroom: 0 };
    var room = b.headroom + yearly(line);
    if (line.fixed) return { rate: Math.max(0, cents(room)) };
    return { hours: line.rate > 0 ? Math.max(0, room / line.rate) : 0 };
  }

  /**
   * Months of service that can have posted by `asOf`: a month counts once the next month has
   * begun (arrears). Clamped to [1, plan months].
   */
  function monthsElapsed(plan, asOf) {
    var n = planMonths(plan.planYear).length;
    var e = monthIndex(asOf) - monthIndex(plan.planYear.start);
    return Math.max(1, Math.min(n, e));
  }

  /**
   * Pace of posted spending vs a straight-line share of each code's budget.
   * committed = spent + allocated; expected = auth × monthsElapsed / planMonths; diff = committed − expected.
   * Early in the year a negative diff is usually posting lag, not savings (rows arrive ~1 month late).
   */
  function pace(report, plan, asOf) {
    var A = authOf(plan), months = planMonths(plan.planYear).length;
    asOf = asOf || (report && report.asOf) || plan.planYear.start;
    var me = monthsElapsed(plan, asOf), frac = me / months, byCode = {};
    var rb = (report && report.byCode) || {};
    Object.keys(A).concat(Object.keys(rb)).forEach(function (c) {
      if (byCode[c]) return;
      var r = rb[c] || { spent: 0, alloc: 0 }, auth = A[c] !== undefined ? A[c] : (r.start || 0);
      var committed = cents((r.spent || 0) + (r.alloc || 0)), expected = cents(auth * frac);
      byCode[c] = { auth: auth, spent: cents(r.spent || 0), alloc: cents(r.alloc || 0), committed: committed,
                    available: cents(auth - committed), expected: expected, diff: cents(committed - expected),
                    pct: auth ? committed / auth * 100 : 0 };
    });
    return { byCode: byCode, monthsElapsed: me, months: months, fraction: frac, asOf: asOf };
  }

  /** Provider × service-month grid of posted $ (spent + allocated), keyed by the SERVICE month. */
  function monthGrid(report, plan) {
    var months = plan ? planMonths(plan.planYear) : [], rows = {}, seen = {};
    months.forEach(function (m) { seen[m] = true; });
    ((report && report.rows) || []).forEach(function (R) {
      var m = R.month || (R.date.slice(6) + '-' + R.date.slice(0, 2)), k = R.provider + '|' + R.code;
      var row = rows[k] = rows[k] || { provider: R.provider, code: String(R.code), byMonth: {}, total: 0 };
      var v = (R.spent || 0) + (R.alloc || 0);
      row.byMonth[m] = cents((row.byMonth[m] || 0) + v); row.total = cents(row.total + v);
      if (!seen[m]) { seen[m] = true; months.push(m); }
    });
    months.sort();
    return { months: months, rows: Object.keys(rows).sort().map(function (k) { return rows[k]; }) };
  }

  return {
    weeksFrom: weeksFrom, monthsFrom: monthsFrom, planMonths: planMonths, monthsElapsed: monthsElapsed,
    yearly: yearly, hoursPerWeek: hoursPerWeek, hoursPerMonth: hoursPerMonth, serviceLabel: serviceLabel,
    buildProposal: buildProposal, forecast: forecast, fill: fill, pace: pace, billed: billed, monthGrid: monthGrid,
    cents: cents
  };
});
