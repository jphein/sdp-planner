# sdp-planner — spec (v0.1, 2026-09-30)

**One line:** a free, browser-only tracker for California Self-Determination Program (SDP) families. Drop in the spending plan and the FMS year-to-date report you already receive; get a year-end forecast by service code, a live what-if proposal calculator (who bills what, hours per week), pace against the plan, and a printable proposal. Nothing leaves the browser.

Origin: a private tool built for one family (one family's plan). This repo is a **fresh, generic, data-driven** rebuild. **Zero personal data may enter this repo**: no real names, UCIs, DOBs, invoice numbers, amounts, or real FMS files. Read the private repo for FORMAT and LOGIC only.

## Product rules (these are DDS/FMS facts the tool must encode and show)
1. Budget is authorized **by service code** (e.g. 320, 331, 338, 340, 358). No per-person caps. Money never moves between codes. Under-spend in a code **forfeits** at plan-year end.
2. The FMS report's `Date` column is the **service date**. A monthly invoice appears under the 1st of the month served. Rows appear ~1 month after service; "under pace" early is lag, not savings. The report has no paid date.
3. Rates come from the plan's RATE column. Never infer a rate from a plan line's weekly dollars or from invoice arithmetic.
4. The tool is not financial or legal advice; the regional center certifies plans; the FMS pays. Say so in the UI footer and README.

## Architecture (decided — do not relitigate)
- **Static site, no build step, no framework, no server, no analytics.** Classic `<script>` tags (not ES modules) so `index.html` works from `file://` AND GitHub Pages. Vendored, pinned **SheetJS** (`vendor/xlsx.full.min.js`, Apache-2.0 community edition) parses `.xlsx` in-browser.
- Files: `index.html`, `styles.css`, `app.js` (UI), `model.js` (pure logic, no DOM), `parsers/ace.js` (ACE FMS plan + YTD report), `parsers/index.js` (detect + registry), `demo/demo-data.js` (synthetic plan + report so the page works with zero files), `vendor/`, `tests/` (node `--test`), `scripts/` (CDP smoke, fixture generator), `docs/`.
- Persistence: `localStorage` (proposal state, named scenarios, imported data), plus Export/Import JSON. Users can clear everything with one button.
- Theme: port the "typeset ledger" look from the private page (Fraunces / Instrument Sans / IBM Plex Mono via Google Fonts with system fallbacks; warm paper light, midnight-gold dark via `prefers-color-scheme`; ruled tables; FITS/OVER stamp). SVG favicon. Print CSS. **Accessibility is a requirement:** every input labelled (visible or `aria-label`), keyboard operable, visible focus, WCAG AA contrast in both themes, tables with `<th scope>`, live region for the verdict.
- Every project with a web presence in JP's world uses **realm-sigil** (`~/Projects/realm-sigil`, static `build.sh`) and registers in `status.realm.watch/checks.json`. Include it if it fits a static site; if it needs a server, document why not.

## Shared interface (Morpheus provides, Luna consumes — agree here, not in DMs)
```js
window.SDP = {
  parsers: {
    detect(workbook) -> 'ace-plan' | 'ace-report' | null,      // by sheet names / header cells
    parse(workbook)  -> { kind, data }                           // dispatch
    ace: { plan(wb) -> Plan, report(wb) -> Report }
  },
  model: {
    weeksFrom(ym, yearEnd), monthsFrom(ym, yearEnd),
    buildProposal(plan, report, opts) -> Line[]                  // default lines from plan (+ last year's report if given)
    forecast(lines, auth) -> { byCode: {code:{proposal, headroom}}, total, fits, overCodes },
    pace(report, plan, asOf) -> { byCode: {code:{spent, alloc, available, expected, diff, pct}}, monthsElapsed },
    reconcile? (later)
  },
  demo: { plan: Plan, report: Report }
};
// Plan  = { planYear:{start:'YYYY-MM-DD', end:'YYYY-MM-DD'}, participant:{name?, uci?}, coordinator?, fms:{name, vendorNumber?, model?},
//           codes:{ '320':{name, auth}, ... }, lines:[{code, description, providers:[string], unitsPerYear, unit, rate, yearly}], total }
// Report= { asOf:'YYYY-MM-DD', rows:[{date:'MM/DD/YYYY', type, provider, code, description, spent, alloc, invoice?}],
//           byCode:{ '320':{spent, alloc, available} }, byProvider:{ name: total } }
// Line  = { id, provider, code, service, rate, hours, start:'YYYY-MM', fixed:bool, note? }   // yearly $ = fixed ? rate : hours*rate
```
ACE formats (from the private repo, structure only): plan workbook sheet `Sheet2` — header row containing `SDP SERVICE CODE`, columns: code(2), description(3), provider(4), units(7), unit type(8), frequency(9), yearly units(10), RATE(11), adjusted rate(12), one-time(13), yearly $(14); code group rows `Living Arrangement (310-321)` etc.; participant row after `Participant's Name:`; FMS header string like `316 - FMS Co-Employer, $NNN/Month, Vendor #:XX0000`. Report workbook sheets `Report` (sections `SC-320 ...`, rows `[_, date, type, provider, description, startBal, spent, alloc, availBal]`, `Total` rows), `SVC` (code, spent, alloc, grand, _, available), `copy` (category, code, date, type, provider, invoice#, description, spent), `Provider Report`.

## Team & ownership (one owner per path; talk via SendMessage; write findings to scratch/<name>.md)
- **morpheus-core** — `model.js`, `parsers/*`, `demo/demo-data.js`, `tests/unit/*`. Pure logic, node-testable, no DOM.
- **luna-ui** — `index.html`, `styles.css`, `app.js`. Ports the calculator (every field editable, start month, hr/wk·hr/mo·hr/yr·$ two-way, fill, undo, named scenarios, editable budgets, pots, stamp, pace table, provider×month, plan lines, invoices) against `window.SDP`; drop-zone onboarding; demo mode; a11y; print.
- **nebula-docs** — `README.md`, `docs/PRIVACY.md`, `docs/ADDING-AN-FMS.md`, `CONTRIBUTING.md`, `.github/workflows/pages.yml` (deploy static root to GitHub Pages), realm-sigil + status registration, `docs/SPEC.md` upkeep.
- **lucid-qa** — `tests/fixtures/` (synthetic ACE-format `.xlsx` generated by a node script with obviously fake names), `scripts/cdp-smoke.mjs`, `scripts/a11y-check.mjs` (contrast + labels via CDP), `tests/e2e/*`.
- **oracle** (end) — read-only: no personal data (grep for the private repo's names/UCI), license, a11y checklist, file:// works, Pages live.

## Definition of done (per CLAUDE.md "Definition of done")
Changed / Checked / Evidence / Not verified in every report. Green: `node --test` passes; `scripts/cdp-smoke.mjs` passes on the demo dataset AND on a synthetic ACE fixture; page renders from `file://` and from the Pages URL; Oracle finds zero personal data. Merge order: morpheus → lucid fixtures → luna → nebula, rebase-next-on-demand, squash, one PR per lane.
