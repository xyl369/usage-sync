# Changelog

Version numbers match `extension/manifest.json`.

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
