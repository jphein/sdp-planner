# Merge log

The first-generation repository was rebuilt on 2026-09-30 before going public: history was rewritten to replace a few strings copied from a private plan with placeholders (see docs/SPEC.md, "Zero personal data"). GitHub's pull-request records did not survive that rebuild, so they are preserved here. Every PR was gated and merged by the team lead under the maintainer's standing "merge your own work" rule; each body records the gate that was run.

## PR #1 — feat(core): ACE parsers, model, demo data, unit tests

Merged 2026-09-30T18:54:44Z by null · head `e293398` · squash `13296d1`

Core logic lane: SheetJS CE 0.20.3 vendored (Apache-2.0), ACE plan + YTD report parsers with SVC/Provider cross-check, forecast/pace/proposal model, synthetic demo dataset, 27 node tests.

Gate (lead, 2026-09-30): `node --test --test-reporter=tap tests/unit/*.test.js` → 27 pass / 0 fail on the PR head. Perturbations (by morpheus-core): pooled budgets → 1 red; dropped arrears rule → 3 red; restored → green. Personal-data grep over the lane (private names, UCI, vendor #, invoice #s, plan dollar figures) → 0 hits in lane files. Secret scan (grep fallback; gitleaks not installed) → none. Real ACE files parsed read-only in memory: totals tie to the cent, 0 mismatches. Cross-model check: none (routine logic).

Merged by the lead under CLAUDE.md "JP is never the bottleneck". Not verified: non-ACE layouts; Excel serial dates only on synthetic cells; UI integration.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

## PR #2 — chore: ignore .claude/ (lane worktrees)

Merged 2026-09-30T18:57:24Z by null · head `e873b52` · squash `65fc930`

One-line .gitignore addition so lane worktrees never show as untracked. Gate: diff is one line, no code. Merged by the lead.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

## PR #3 — feat(ui): typeset-ledger app — onboarding, calculator, pots, pace, tables, print

Merged 2026-09-30T18:58:58Z by null · head `7c1b885` · squash `3565962`

index.html / styles.css / app.js: generic port of the ledger UI. Drop zone + file picker via SDP.parsers (any registered FMS), Try the demo, hero hr/wk per code with FITS/OVER stamp, fully editable calculator (start month, hr/wk↔mo↔yr↔$, fill, undo, add, scenarios, editable budgets), pots, pace, provider×month, plan lines, invoices, localStorage + Export/Import + Clear my data, print CSS, disclaimer footer. a11y: labelled controls, th scope, aria-live verdict, AA contrast both themes.

Gate (lead): rebased on main 65fc930; personal-data grep on the 3 files → none; secret grep → none; node --test → 27/27; headless render of ?demo=1 → stamp, 2 aria-live regions, 111 scoped th, no non-font network requests; screenshot reviewed. Lane checks (luna-ui): contrast 0 fails light+dark with a positive control, mobile 390px no overflow, print 6 pages, undo exact, fixtures loaded through the real file input. Not verified: Pages hosting, real screen reader, real drag-drop, Firefox/Safari. Merged by the lead under CLAUDE.md "JP is never the bottleneck".

🤖 Generated with [Claude Code](https://claude.com/claude-code)

## PR #4 — feat(ui): run on merged core only; $/hr entry for weekly plan lines; QA DOM contract

Merged 2026-09-30T19:00:59Z by null · head `8ab6436` · squash `56a779a`

Follow-up to #3 (luna-ui 7ef47a2): stub removed, app runs on the merged core only with a plain message if a script fails to load; onboarding via parsers.fromArrayBuffer with a friendly unrecognised-file line; fixed lines from $/week or $/day plan lines get a $/hr input that converts to hourly on commit (no rate inferred, Undo reverts); Lucid DOM contract (data-k t/c/svc/st/rate/wk/mo/hrs/dol, #fileInput, [data-head=code], read-only SDP.app.state()).

Gate (lead): cherry-pick onto main 3565962 clean; personal-data grep → none; node --test → 27/27; headless render ?demo=1 → stamp present. Lane checks (luna-ui): contrast 0/0 both themes with positive control, unlabelled 0, fixtures via #fileInput recognised as ACE with auth matching expected.json, $40 conversion → 130 hr and Undo restores. Merged by the lead under CLAUDE.md "JP is never the bottleneck".

🤖 Generated with [Claude Code](https://claude.com/claude-code)

## PR #5 — test: synthetic ACE fixtures, CDP smoke test, a11y check

Merged 2026-09-30T19:04:09Z by null · head `a9c8abd` · squash `1462026`

lucid-qa lane (b5fa49b, 2589410, 64362af cherry-picked onto main): scripts/make-fixtures.mjs generating obviously-fake ACE-layout workbooks (tests/fixtures/ace-plan.xlsx, ace-report.xlsx, expected.json), scripts/cdp-smoke.mjs (demo + fixtures through the parsers and the real calculator), scripts/a11y-check.mjs (labels, th scope, AA contrast both themes, focus), tests/e2e/README.md, package.json scripts.

Gate (lead) on main 56a779a + these commits: personal-data grep → none; node --test → 27/27; make-fixtures regenerates byte-identical fixtures; cdp-smoke → 28 passed / 0 failed (hr/wk edit flips stamp Fits→Over, fill closes pot to $0, start-month change keeps hr/wk, undo, budgets, scenario round-trip, reload, zero exceptions); a11y-check → see run output in this PR thread. Merged by the lead under CLAUDE.md "JP is never the bottleneck".

🤖 Generated with [Claude Code](https://claude.com/claude-code)

## PR #6 — fix(ui): AA contrast for light --ink-3/--warn on --paper-3; exact undo on select change; state().yearEnd

Merged 2026-09-30T19:07:11Z by null · head `6b4f008` · squash `e2f38dd`

luna-fix 9395556: light tokens --ink-3 #625e55, --warn #875210 (both ≥4.5:1 on --paper-3 hover bg); undo snapshots on select change, deduped; SDP.app.state() returns yearEnd.

Gate (lead): unit 27/27; a11y-check 19/19 (was 18/19); cdp-smoke 28/28; grep clean. Merged by the lead.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

## PR #7 — test(unit): parse lucid's ACE fixtures from disk against expected.json

Merged 2026-09-30T19:07:22Z by null · head `a169592` · squash `9c5c5d9`

morpheus dedcf4e: tests/unit/fixtures.test.js reads tests/fixtures/*.xlsx through SDP.parsers and checks plan/report against expected.json incl. the swapped-code invoice; skips if fixtures absent.

Gate (lead): unit 29/29. Perturbation (morpheus): wrong invoice number attached → 1 fail; restored → green. Merged by the lead.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

## PR #8 — docs+ci: families-first README, privacy, adding-an-FMS, contributing, Pages workflow with sigil stamp

Merged 2026-09-30T19:08:04Z by null · head `89b11e2` · squash `232e133`

nebula-docs lane (9 commits): README (families first, then contributors), docs/PRIVACY.md, docs/ADDING-AN-FMS.md aligned to parsers/index.js registry, CONTRIBUTING.md with the no-real-participant-data rule, .github/workflows/pages.yml (push to main + workflow_dispatch; contents:read/pages:write/id-token:write; checkout/configure-pages/upload-pages-artifact/deploy-pages pinned to SHAs; realm-sigil stamp pinned by SHA, deploy-time only), SPEC: sigil decision, $NNN placeholder rule, least-disclosure origin line.

Gate (lead): personal-data grep over docs/README/CONTRIBUTING/.github → clean; pages.yml parses. Independent Oracle review (oracle-verify, read-only, CI-workflow code): all four action SHAs verified equal to their tags via gh api; permissions least-privilege; no secrets, no pull_request trigger, persist-credentials false; sigil build.sh at pinned SHA executes nothing from the deployed repo; artifact excludes .git/.github/dotfiles; LICENSE canonical MIT. Oracle LOW: workflow_dispatch kept knowingly for manual redeploys. Pages not yet enabled (repo private) so the first run will fail at configure-pages; expected. Merged by the lead under CLAUDE.md "JP is never the bottleneck".

🤖 Generated with [Claude Code](https://claude.com/claude-code)

## PR #9 — test+demo: synthetic PA rate 35.00 replaces the real prior-year rate; fixture test tolerant of expected.json field names

Merged 2026-09-30T19:09:53Z by null · head `15eb7d9` · squash `f25be44`

morpheus 9bc4157 + 283264a: fixtures.test.js compares only fields expected.json lists (unit|unitType, fms minus name); the real 2025-26 PA rate the real prior-year rate replaced by synthetic 35.00 in demo-data.js and three unit test files with all dependent totals recomputed; lastYear test rate set to 34 so it still discriminates.

Gate (lead): unit 29/29; old-rate grep → 0 hits incl. vendor; real-rate grep → 0 hits outside vendor (morpheus). Oracle finding 3 resolved in-tree (history handled by the pre-public rewrite). Merged by the lead.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

## PR #10 — test(e2e): expected.json aligned to parser field names; smoke asserts report checks.ok

Merged 2026-09-30T19:11:00Z by null · head `299bf05` · squash `257a765`

lucid 35685e5: expected.json uses unitType and fms.vendorNumber only; cdp-smoke asserts the report ledger ties to its SVC and Provider sheets (checks.ok). 

Gate (lead) on main after the morpheus scrub: unit 29/29; make-fixtures byte-identical; cdp-smoke pass (see run line); a11y-check pass (see run line). Perturbation (lucid): model.fill +1 hr → both fill checks red by one rate. Merged by the lead.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

