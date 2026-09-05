# Changelog

Version numbers match `extension/manifest.json`.

## [1.5.1] — 2026-09-05

### Fixed

- Gemini weekly % no longer picks a middle RPC bucket (dashboard showed 9% while official Weekly limit was 29%)
- Pair 5-hour vs weekly by reset time: sooner reset = current usage, later reset = weekly limit
- Prefer the official `/usage` tab DOM over a Gemini chat tab
- Stop overwriting a correct section scrape with the 2nd “已使用” on the page

## [1.5.0] — 2026-09-05

### Added

- One refresh icon next to **Usage** on the combined dashboard. Click once to update Cursor and Gemini in place — no new tab, no full page reload
- Extension background fetch: Cursor `GET /api/usage-summary` (same pool percentages as the official dashboard) and Gemini `batchexecute` usage RPC
- Fallback: if the API path fails, reuse an already-open official tab and scrape it (still no new tab)
- Popup **Refresh quotas** now triggers the same silent fetch

### Notes

- Chrome must be signed in to Cursor and Gemini in this profile
- After upgrading, reload the unpacked extension to **1.5.0** and reopen the local HTML tab
- File URL access is still required so the dashboard can receive the numbers

## [1.4.2] — 2026-09-02

### Fixed

- Cursor pool total uses the largest % in that section (avoids sub-model rows like 33.5% instead of 39.2%)
- Gemini usage scripts run in iframes; current / weekly take the official on-page order
- File-page bridge always binds if `#usage-sync-slot` exists, and applies via a page-world event

## [1.4.1] — 2026-09-02

### Fixed

- Align Cursor sliders to **pool totals** (Cursor Models / Other Models), not sub-model rows
- Read Chinese billing copy (`光标模型`, `包含用途`) and the Aug–Sep cycle length
- Manager bridge detects any local dashboard with the official slider IDs and writes aliases
- Gemini 5-hour window text updates immediately, not only after a page hook

## [1.4.0] — 2026-09-02

### Added

- Combined local dashboard `managers/index.html`: Cursor and Gemini side by side
- Extension bridge applies both Cursor and Gemini sync on the combined page
- English / 中文 toggle on the combined dashboard

### Changed

- Combined dashboard is the primary UI; standalone manager pages remain for bookmarks

## [1.3.5] — 2026-07-24

### Added

- Open-source release: Chrome extension + Cursor / Gemini local usage managers
- `docs/RULES.md` field mapping and formulas

### Fixed

- Spending page `XX% used` scrape
- Billing table same-line percentages (Cursor Models / Other Models)

### Docs / UI

- English-only UI and manager filenames (`cursor-usage-manager.html`, `gemini-quota-manager.html`)

### Earlier (pre-open-source)

- **1.3.4** — Cursor Models / Other Models label support
- **1.3.0** — content-script isolation broke slider updates
- **1.0.0** — extension first version
