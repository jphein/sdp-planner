# Contributing to sdp-planner

Thank you for helping SDP families plan. Issues, fixes and new FMS parsers are all welcome.

## 🔴 Hard rule: no real participant data, anywhere

**Never put real participant data in an issue, a comment, a fixture, a screenshot, a commit or a pull request.** This includes:

- names of participants, family members, providers or coordinators;
- UCI numbers, dates of birth, addresses, phone numbers, email addresses;
- invoice numbers, vendor numbers and real dollar amounts from a real plan;
- real FMS exports or spending plans, even "just for a minute", and even in a private fork.

This project is meant to be public, and a git history is forever. A pushed file with a real UCI in it cannot be fully taken back. Pull requests that contain real data will be closed, and the data will be scrubbed from history.

What to do instead:

- **Reporting a bug?** Describe it using the built-in demo data, or with made-up numbers ("code 320, authorized $10,000, one provider at $20/hr").
- **Need a sample file?** Build a synthetic one. See [`docs/ADDING-AN-FMS.md`](docs/ADDING-AN-FMS.md) → *Building a synthetic fixture*, and the redaction checklist there.
- **Screenshots** use the demo dataset only.

If you accidentally post real data in an issue, edit it out right away and tell a maintainer so the edit history can be purged too.

## Ground rules for code

These are decided in [`docs/SPEC.md`](docs/SPEC.md); please don't relitigate them in a PR:

- **Static site, no build step, no framework, no server, no analytics.** Classic `<script>` tags, so `index.html` works from `file://` and from GitHub Pages. No ES modules and no bundler.
- **Nothing leaves the browser.** A PR that adds a network request, a third-party script or new storage must update [`docs/PRIVACY.md`](docs/PRIVACY.md) and explain why.
- **`model.js` stays pure:** no DOM, testable with node.
- **Encode the DDS/FMS rules faithfully:** budgets are per service code, money never moves between codes, under-spend forfeits, the report's `Date` is the service date, and rates come from the plan's RATE column (never worked out from weekly dollars or invoice arithmetic).
- **Accessibility is a requirement:** labelled inputs, keyboard operable, visible focus, WCAG AA contrast in both themes, `<th scope>` on tables.
- Keep the light and dark themes (`prefers-color-scheme`) and the print stylesheet working.

## Workflow

1. Fork, then branch: `<type>/<short-description>` (e.g. `feat/gt-independence-parser`, `fix/pace-leap-year`).
2. Make small commits in [conventional style](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `test:`, `chore:`.
3. Run the checks:
   ```bash
   node --test tests/unit/*.test.js
   TMPDIR=$(mktemp -d) node scripts/cdp-smoke.mjs
   ```
   New logic gets unit tests. The smoke test must pass on the demo data and on a synthetic fixture.
4. Look at the page in light and dark themes, and in print preview, if you touched the UI.
5. Open a pull request. Say what changed, how you checked it, and what you didn't check.

## Adding support for another FMS

Most useful contributions will be parsers for FMS providers beyond ACE. Start with [`docs/ADDING-AN-FMS.md`](docs/ADDING-AN-FMS.md).

## License

By contributing you agree your contribution is licensed under the MIT License in [`LICENSE`](LICENSE).
