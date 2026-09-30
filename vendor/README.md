# vendor/

| File | Library | Version | License | Source |
|---|---|---|---|---|
| `xlsx.full.min.js` | SheetJS Community Edition | 0.20.3 | Apache-2.0 (`LICENSE-sheetjs.txt`) | https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js |

sha256 `cc015130aa8521e7f088f88898eba949ccdcbfb38df0bd129b44b7273c3a6f41` (fetched 2026-09-30).

Pinned and vendored so the page works from `file://` with no network. The npm registry's
`xlsx` package is frozen at an old, vulnerable 0.18.x; SheetJS publishes current builds only on
its own CDN. To upgrade: download the new `xlsx.full.min.js` + `LICENSE` from
`https://cdn.sheetjs.com/xlsx-<ver>/package/`, update this table and the sha256, run `node --test tests/unit`.
