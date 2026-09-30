# End-to-end checks

Three scripts drive the real page in headless Chrome over the DevTools Protocol. They need **Node 22+**
(global `WebSocket` and `fetch`) and a local **`google-chrome`** (set `CHROME=/path/to/chrome` to
use another binary). There are no npm dependencies.

| Command | Script | What it proves |
|---|---|---|
| `npm run fixtures` | `scripts/make-fixtures.mjs` | Regenerates `tests/fixtures/*.xlsx` and `expected.json`, byte-for-byte the same on every run |
| `npm run smoke` | `scripts/cdp-smoke.mjs` | Parsers read the fixtures correctly, and the calculator works in demo mode and with the fixtures loaded |
| `npm run a11y` | `scripts/a11y-check.mjs` | Labels, `<th scope>`, WCAG AA contrast in light **and** dark, visible keyboard focus |

Each script exits `0` when every check passes and `1` otherwise. Each prints one `ok` or `FAIL` line
per check, and a failing line names the element (selector path) and the values it measured.

```sh
npm run smoke                                   # against ./index.html
node scripts/cdp-smoke.mjs --root ../other-tree  # or any directory that has an index.html
node scripts/a11y-check.mjs --verbose            # also lists exempt elements, token pairs, unreached tab stops
```

Each run uses a throwaway Chrome profile (in `$TMPDIR`, deleted afterwards), and Chrome picks its
own debugging port, so parallel runs don't collide.

## Fixtures

`tests/fixtures/ace-plan.xlsx` and `ace-report.xlsx` are **synthetic**. The names ("Alex Rivera",
"Example Transit"), UCI `0000000`, vendor `ZZ0000` and round-number amounts are made up. Only the
layout mirrors real ACE FMS exports:

- **plan:** sheet `Sheet2`. The FMS header string is in C3 and the participant row sits under
  `Participant's Name:`. The column header row starts with `SDP SERVICE CODE` in column C, followed by
  code-group rows (`Living Arrangement (310-321)` …), line rows, `… Total` rows, and the
  `SDP Authorizations` block. The FMS line (316) is listed but carries $0.
- **report:** sheet `Report` holds category summaries, then per-code sections (`SC-320 …`, a `Date`
  header, a `Spending Plan Starting Balance` row, transactions, `Total`). `SVC` holds per-code totals,
  `copy` holds a flat ledger with invoice numbers, and `Provider Report` holds per-provider totals.
- **known quirk:** invoice `9000002` books its two lines under **swapped** codes: the
  attendant-care line sits in SC-331 and the community-integration line in SC-320. The FMS report is
  the record of what was booked where, so a parser must keep the booked code, and totals still tie to
  `SVC`.

`expected.json` holds the values a correct parser must recover. The smoke test asserts against it.
If you change the generator, run `npm run fixtures` and commit all three files together.

## Selector contract (what the smoke test drives)

| Hook | Meaning |
|---|---|
| `#calcBody tr` | one proposal line per row |
| `[data-k=provider\|code\|service\|rate\|start\|wk\|mo\|hrs\|dol]` | row fields (`start` is a `YYYY-MM` select). Numbers fire `input`, selects fire `change` |
| `[data-fill]`, `[data-del]` | per-row fill-to-$0 and remove buttons |
| `#stamp` | text contains `FITS` or `OVER` |
| `#undoBtn`, `#resetBtn`, `#addBtn` | proposal controls |
| `#scnName`, `#scnSave`, `#scnSel` | named scenarios (`#scnSel` option value = name) |
| `[data-auth="<code>"]` | editable budget per service code |
| `[data-head="<code>"]` *(optional)* | headroom text. If absent, the smoke test computes headroom with `SDP.model.forecast` from `SDP.app.state()`, or else from the page's saved `localStorage['sdp-planner:v1']` |
| `#demoBtn`, `?demo=1` | demo mode |
| `input[type=file]` (+ `#openBtn` if present) | onboarding: files are set through CDP `DOM.setFileInputFiles`, the way a user picks them |

Older aliases (`t`, `c`, `st`, `svc`) are accepted too.

## Measurement notes (why the scripts do what they do)

- **Focus emulation is on.** A headless page never has OS focus, so `el.focus()` fires no
  `focusin` and `:focus-visible` never matches. Undo snapshots taken on `focusin` would then silently
  not happen, and undo would appear to jump two steps.
- **The a11y check waits for animations and transitions to finish** before measuring. The page
  fades sections in and transitions `outline-color`, so reading early reports false contrast and
  focus-ring failures.
- **Contrast is measured per element** from computed styles. The background is composited up the
  ancestor chain with alpha and ancestor `opacity`, and text over a background image is skipped and
  listed. Disabled controls and decorative text below 20% opacity are exempt (WCAG "incidental").
  The **token** check also pairs every text-like `:root` custom property with every opaque
  paper/background token, which catches a pairing that the current DOM happens not to render.
- **Negative controls.** Both scripts were run against pages built to fail. The smoke test reported
  15 failures on an empty page. The a11y check flagged a planted unlabelled input, a `<th>` with no
  scope, #999-on-#fff text and `outline:none`. A green run therefore means the checks could see.
