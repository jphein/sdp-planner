# Adding another FMS

sdp-planner reads ACE FMS exports today. Every FMS (Financial Management Service) sends SDP families the same two things in its own layout: an **approved spending plan** and a **year-to-date spending report**. Examples include Aveanna (formerly Premier), GT Independence and Mains'l. Supporting another FMS means writing one parser file that turns its layout into the shared `Plan` and `Report` shapes. The model, calculator and pages don't change.

> **Before you start:** read the hard rule in [`CONTRIBUTING.md`](../CONTRIBUTING.md). Never commit, attach or paste a real export. Work from a synthetic fixture (below).

## 1. The contract

The parsers live on `window.SDP.parsers` (see [`SPEC.md`](SPEC.md) → *Shared interface*). Each FMS gets one module:

```js
// parsers/<id>.js — a classic script (no import/export), loaded before parsers/index.js
(function (root) {
  const SDP = (root.SDP = root.SDP || {});
  SDP.parsers = SDP.parsers || {};

  SDP.parsers.gti = {                       // <id>: short, lowercase, unique
    id: 'gti',
    label: 'GT Independence',

    // Look at sheet names and header cells ONLY. Return 'plan', 'report' or null.
    // Must be cheap, must never throw, and must return null for another FMS's files.
    detect(wb) { /* ... */ return null; },

    plan(wb)   { /* -> Plan   */ },
    report(wb) { /* -> Report */ },
  };
})(typeof window !== 'undefined' ? window : globalThis);
```

`parsers/index.js` registers every object on `SDP.parsers` that has an `id` and a `detect` as it loads, so a module only has to be loaded **before** `parsers/index.js`. For a module loaded later, call `SDP.parsers.register(mod)`. It throws if `detect`, `plan` or `report` is missing.

- `SDP.parsers.detect(wb)` asks the registered modules in load order. The first non-null answer wins and comes back as `'<id>-plan'` or `'<id>-report'` (ACE yields `'ace-plan'` / `'ace-report'`), otherwise `null`.
- `SDP.parsers.parse(wb)` returns `{ kind, fms: '<id>', data }` and throws `Unrecognized workbook` if no module claims the file.
- `SDP.parsers.list()` returns `[{ id, label }]` for every registered FMS, for example so the UI can name the formats it supports.

The browser hands you a SheetJS workbook (`vendor/xlsx.full.min.js`), read with SheetJS **default options** (`XLSX.read(bytes, { type: 'array' })`, no `cellDates`). So dates reach you as whatever the file stores: Excel date serial numbers or text. Convert them yourself. Use `XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true })` to get rows as arrays. The same code runs under node for tests, because the modules attach to `globalThis`. The `registry:` test in `tests/unit/parsers.test.js` shows a new module plugging in.

### What you must return

These are the shapes from [`SPEC.md`](SPEC.md), with the rules each field has to follow:

```js
Plan = {
  planYear:   { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' },
  participant:{ name?, uci? },             // optional; displayed locally only, never required
  coordinator?,
  fms:        { name, vendorNumber?, model? },   // model: e.g. 'co-employer', 'sole-employer', 'bill-payer'
  codes:      { '320': { name, auth }, ... },    // auth = authorized $ for the year, per SERVICE CODE
  lines:      [{ code, description, providers: [string], unitsPerYear, unit, rate, yearly }],
  total,
}

Report = {
  asOf: 'YYYY-MM-DD',
  rows: [{ date: 'MM/DD/YYYY', type, provider, code, description, spent, alloc, invoice? }],
  byCode:     { '320': { spent, alloc, available } },
  byProvider: { 'Provider name': total },
}
```

Rules that the rest of the tool relies on:

1. **Service codes are strings** (`'320'`, not `320`), and **budgets are per code**. Never make per-person caps, and never merge two codes.
2. **`rate` comes from the plan's rate column, verbatim.** Never work it out as `yearly / units` or from weekly dollars, even when it divides evenly. If the export has no rate column, leave `rate` undefined and say so in the PR.
3. **`rows[].date` is the service date** as the FMS reports it. Don't shift it to a posting or paid date. If the FMS gives several dates, pick the service date and write down which column it is.
4. **Money is a number in dollars**, not a formatted string. Strip `$` and `,`, and turn `(12.34)` into `-12.34`.
5. **Reconcile before returning.** If the export has its own totals (a per-code summary sheet or `Total` rows), check that the sum of `rows` matches them to the cent. On a mismatch, throw a clear `Error` rather than return numbers that are quietly wrong.
6. **No DOM, no network, no storage.** Parsers are pure functions of the workbook.

### How ACE does it (a worked reference)

`parsers/ace.js` is the reference implementation. In outline:

- **Plan:** the sheet `Sheet2`; a header row containing `SDP SERVICE CODE`; group rows like `Living Arrangement (310-321)`; the participant row after `Participant's Name:`; and an FMS header string like `316 - FMS Co-Employer, $NNN/Month, Vendor #:XX0000`.
- **Report:** the sheets `Report` (per-code sections `SC-320 …` with `Total` rows), `SVC` (the per-code summary used to reconcile), `copy` (the flat transaction list) and `Provider Report`.

Your FMS will differ. Find the equivalent of each piece.

## 2. Building a synthetic fixture

You need a workbook with **your FMS's exact structure and entirely fake content**. The safest way is to build it from code, not by editing a real file. The fixture generator lives in `scripts/` (start from the ACE generator), and fixtures go in `tests/fixtures/`.

1. **Copy the structure, not the file.** Open your real export and write down, on paper or in a local note that you never commit:
   - the sheet names, in order;
   - the header rows, with the exact text of each header cell, including odd spacing and capitals;
   - where the sections start and end, what total rows look like, and any merged cells or blank spacer rows;
   - how dates and money are formatted (Excel date serials or text? `$1,234.56` or `1234.56`?).
2. **Generate it.** Add a function to the fixture generator that writes a workbook with that structure using SheetJS (`XLSX.utils.aoa_to_sheet`, `XLSX.writeFile`). Fill it with **obviously fake** data:
   - names like `Pat Example`, `Provider Alpha`, `Sample Care Agency`;
   - a UCI like `0000000`, and a vendor number like `XX0000`;
   - round, made-up rates and amounts (`$20.00/hr`, `$1,000.00`) that **reconcile**: rows sum to the per-code totals, and totals match the summary sheet.
3. **Cover the awkward cases:** a code with no spending yet, a negative adjustment row, a provider billing under two codes, a month with no rows, and a plan-year boundary.
4. **Write the tests** in `tests/unit/<id>.test.js`: `detect()` recognises your fixture and returns `null` for the ACE fixtures (and ACE's `detect()` returns `null` for yours), `plan()`/`report()` return the right shapes, and the reconcile check throws on a deliberately broken total.
5. **Smoke test** the page with your fixture: `TMPDIR=$(mktemp -d) node scripts/cdp-smoke.mjs`.

## 3. If you must share a sample export: redaction checklist

A generated fixture is always better. If a maintainer needs to see how a real export is laid out, send a **redacted copy** privately (never in a public issue or PR), and go through every item below:

- [ ] **Participant:** name, UCI, date of birth, address, phone, email, Medi-Cal/CIN or SSN fragments.
- [ ] **Family, coordinator, facilitator, regional center staff:** every name and contact detail.
- [ ] **Providers and workers:** names, employee IDs, vendor numbers, agency names if they identify a small provider.
- [ ] **Money:** replace every amount with a fake one (and keep totals consistent, or say they're not).
- [ ] **Invoice, check, claim and authorization numbers.**
- [ ] **Dates of birth and exact service dates.** Shift all dates by the same offset if the order matters.
- [ ] **Free-text fields:** descriptions, notes and comments often contain names or diagnoses. Replace them with `Description`.
- [ ] **Hidden content:** hidden sheets, hidden rows and columns, cell comments, named ranges, headers and footers, and the document properties (File → Info: author, company, last modified by). Excel's *Inspect Document* (File → Info → Check for Issues) removes most of it.
- [ ] **Filename:** it often contains the participant's name or UCI. Rename it `sample-<fms>-report.xlsx`.
- [ ] **Screenshots:** crop or blur. Better, screenshot your synthetic fixture instead.

When in doubt, leave it out. Describe the layout in words ("row 7 is the header; column C is the service code") instead.

## 4. Open the pull request

- One FMS per PR: `parsers/<id>.js`, its `<script>` tag in `index.html` (before `parsers/index.js`), the fixture generator change, fixtures, and tests.
- In the description, name the FMS, the export's name as it appears in their portal, and the columns you mapped to `rate`, service `date` and `code`.
- Add a line to the README's *Getting your two files* section saying how a family downloads that FMS's plan and report.
