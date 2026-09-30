# CLAUDE.md — sdp-planner

Public, browser-only tracker for California Self-Determination Program spending plans. Read `README.md` and `docs/SPEC.md` first; the SPEC holds the architecture decisions and the product rules the numbers depend on.

## Hard rules
- **No real participant data, ever**: no real names, UCIs, dates of birth, invoice numbers, real plan dollar figures or real FMS exports in code, fixtures, docs, issues or PRs. Demo and fixture data must be obviously synthetic. Any dollar figure copied from a real plan counts as personal data; use `$NNN`.
- Budget lives **by service code**; no per-person caps; unspent money forfeits at year end. The FMS report's `Date` is the **service date**. Rates come only from the plan's RATE column; never infer one from weekly dollars or invoice arithmetic.
- Static site, no build step, no framework, no server, no analytics. Classic scripts so `index.html` works from `file://` and from GitHub Pages. The only third-party request is Google Fonts.
- Accessibility is a requirement: labelled controls, `th scope`, visible focus, AA contrast in both themes, `aria-live` verdict.

## Working here
- Tests: `npm test` (node --test, glob form is required on Node 24). Page checks: `npm run smoke` and `npm run a11y` drive headless Chrome over CDP; both must exit 0 before a UI change merges. `npm run fixtures` regenerates the synthetic ACE workbooks byte-identically.
- Adding an FMS parser: `docs/ADDING-AN-FMS.md`. Privacy statement: `docs/PRIVACY.md`.
- Deploy: `.github/workflows/pages.yml` publishes the repo root to GitHub Pages on push to `main`, stamping a realm-sigil `version.json` at deploy time. Actions are pinned to SHAs; keep them pinned.
- Branch + PR for every change; squash-merge; record the gate that was run in the PR body (see `docs/MERGE-LOG.md` for the form).
