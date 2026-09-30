# sdp-planner

A free, browser-only plan tracker for California **Self-Determination Program (SDP)** families.

Drop in the two files you already get — your **spending plan** and your FMS **year-to-date spending report** — and see:

- a **year-end forecast by service code**: will each code fit its budget, or run over?
- a live **what-if calculator**: who bills what, how many hours a week, starting which month;
- **pace against the plan**: how much each code has spent so far versus where it "should" be;
- a **printable proposal** you can bring to your planning team.

There is a demo with made-up data, so you can try it before loading anything of your own.

> **Status:** under construction (2026-09-30). The design is in [`docs/SPEC.md`](docs/SPEC.md).

---

## For SDP families

### Your data stays on your computer

1. **It runs in your browser.** The page is plain HTML and JavaScript. Your files are read by your own browser; there is no server doing the math.
2. **No account.** There is nothing to sign up for and nothing to log in to.
3. **No upload.** Your spending plan and FMS report are never sent anywhere. What you enter is saved only in your browser's own storage on this device, and a **Clear my data** button erases it.

The one outside request the page makes is for its fonts (from Google Fonts); it carries no plan data. [`docs/PRIVACY.md`](docs/PRIVACY.md) explains that request, how to avoid it, and everything else in plain language.

### Getting your two files

The tool reads the Excel (`.xlsx`) files your FMS (Financial Management Service) provides. It understands the **ACE** FMS format today; other FMS formats can be added (see [Adding another FMS](docs/ADDING-AN-FMS.md)).

**1. Your spending plan.** This is the approved plan your regional center certified: one line per service, with its service code, provider, units and RATE. You usually already have it as an Excel file from your FMS or your independent facilitator. If you only have a PDF, ask your FMS or facilitator for the Excel version.

**2. Your year-to-date "Spending Detail Report".**

1. Sign in to your FMS's online portal (for ACE, the ACE participant portal).
2. Open the **Reports** area and choose the **Spending Detail Report** (year to date).
3. Pick your current plan year and export or download it as **Excel (.xlsx)**, not PDF.

Portal menus change, and the exact names above may not match what you see. If you can't find the report, ask your FMS for "the Spending Detail Report, year to date, as an Excel file". They send it to families routinely.

Then open the page and drop both files onto it (or use the file picker). The tool works out which file is which.

### How the budget works (the one rule the tool is built around)

Your SDP budget is authorized **by service code** (for example 320, 331, 338, 340, 358), not by person. Every provider billing under a code draws from that one code's budget. There is no separate cap per worker, and money **cannot move between codes**: extra room in one code does not cover an overrun in another. Money left unspent in a code at the end of the plan year is **forfeited**, not carried over. Keep in mind too that the FMS report lists charges by the date the **service** happened, and bills usually appear about a month later. So a code that looks "under pace" early in the year is often still waiting on invoices, not really saving money.

### Screenshots

_Screenshots are coming once the interface is finished. They will use the built-in demo data only._

<!-- screenshots: docs/img/forecast.png, docs/img/calculator.png (demo data only, never a real plan) -->

### Not financial or legal advice

This is a free planning aid, not financial, legal or benefits advice. Your **regional center** certifies your spending plan, and your **FMS** pays your providers. Their records are the official ones. If this tool disagrees with them, they are right, and please [open an issue](CONTRIBUTING.md) (without any personal details) so we can fix the tool.

---

## For contributors

Read [`CONTRIBUTING.md`](CONTRIBUTING.md) first. The one hard rule: **no real participant data, ever**, in issues, fixtures, screenshots or pull requests.

### Layout

A static site with no build step, no framework and no server. Everything loads through classic `<script>` tags, so `index.html` works straight from `file://` and from GitHub Pages.

| Path | What it is |
|---|---|
| `index.html`, `styles.css`, `app.js` | The page and its UI (the only files that touch the DOM) |
| `model.js` | Pure budget logic: forecast, pace, proposal lines. No DOM, so node can test it. |
| `parsers/index.js` | FMS file detection and the parser registry (`window.SDP.parsers`) |
| `parsers/ace.js` | ACE plan and YTD-report parser |
| `demo/demo-data.js` | Synthetic plan and report, so the page works with zero files |
| `vendor/xlsx.full.min.js` | Pinned SheetJS community edition (Apache-2.0), which parses `.xlsx` in the browser |
| `tests/unit/`, `tests/e2e/`, `tests/fixtures/` | `node --test` suites (`tests/unit/*.test.js`) and synthetic ACE-format workbooks |
| `scripts/` | CDP smoke test, a11y check, fixture generator |
| `docs/` | Spec, privacy notes, how to add an FMS |

The shared contract (`window.SDP.parsers`, `window.SDP.model`, `window.SDP.demo`) is defined in [`docs/SPEC.md`](docs/SPEC.md).

### Run it

```bash
# open directly (no server needed)
xdg-open index.html            # macOS: open index.html

# or serve it, to match GitHub Pages
python3 -m http.server 8000    # then visit http://localhost:8000/
```

### Test it

```bash
node --test tests/unit/*.test.js                 # unit suites (Node 20+; Node 24 rejects a bare directory)
TMPDIR=$(mktemp -d) node scripts/cdp-smoke.mjs   # drives the page in headless Chrome over CDP
```

The smoke test must pass on the demo dataset **and** on a synthetic ACE fixture before a change is done. Check the page in both light and dark themes.

### Deploy

Pushing to `main` publishes the repository root to GitHub Pages ([`.github/workflows/pages.yml`](.github/workflows/pages.yml)). The workflow also stamps a [realm-sigil](https://github.com/jphein/sigil.realm.watch) `version.json` and a `<meta name="realm-version">` tag into the deployed copy only. The repository itself stays build-free.

## License

MIT. See [`LICENSE`](LICENSE). SheetJS community edition is Apache-2.0.
