# Usage Sync

**Chrome extension + local HTML dashboards for Cursor & Gemini usage tracking**

[Rules](docs/RULES.md) · [Changelog](CHANGELOG.md) · [License](LICENSE)

## What is Usage Sync?

A **local usage tracking** toolkit with two parts:

| Component | Purpose |
|-----------|---------|
| **Chrome extension** (`extension/`) | Scrapes usage % from Cursor / Gemini official pages into browser storage |
| **Local manager pages** (`managers/`) | Progress bars, ideal usage lines, over-limit warnings; manual slider adjustment |

Personal usage visualization for **Cursor** and **Gemini**.

## Repository structure

```
usage-sync/
├── extension/              # Chrome extension (Manifest V3)
│   ├── content/
│   │   ├── cursor.js         # Scrape Cursor Spending / Billing
│   │   ├── gemini.js         # Scrape Gemini Usage
│   │   └── manager-bridge.js # Sync to local HTML managers
│   ├── popup/
│   └── manifest.json
├── managers/
│   ├── cursor-usage-manager.html   # Cursor weighted usage + ideal line
│   └── gemini-quota-manager.html   # Gemini dual-cycle quota
└── docs/
    └── RULES.md              # Field mapping & formulas
```

## Install

```bash
git clone https://github.com/xyl369/usage-sync.git
```

**1. Load extension**

1. Open `chrome://extensions` (Edge: `edge://extensions`)
2. Enable **Developer mode**
3. **Load unpacked** → select `usage-sync/extension`
4. Extension details → enable **"Allow access to file URLs"** (required)

**2. Open local managers**

Open directly in browser (`file://`):

- `managers/cursor-usage-manager.html`
- `managers/gemini-quota-manager.html`

Keep a fixed path; don't run multiple copies from different locations.

## Usage workflow

**Cursor**

1. In `chrome://extensions`, confirm the latest extension code is loaded
2. Open and **hard-refresh** (⌘⇧R) one official page:
   - https://cursor.com/dashboard/spending (recommended)
   - https://cursor.com/dashboard/billing
3. Green toast at bottom-right: `Synced · Cursor Models xx% · Other Models xx%`
4. **Close** the local manager tab, reopen `cursor-usage-manager.html`
5. Green "aligned" banner below plan card = success

**Gemini**

1. Open and refresh https://gemini.google.com/usage
2. After green sync toast, reopen `gemini-quota-manager.html`

## Field mapping

| Official | Local manager |
|----------|---------------|
| Cursor Models % | First-Party slider |
| Other Models % | API slider |
| Gemini weekly limit % | Weekly usage slider |
| Gemini current usage % | Short-cycle read-only bar |

See [docs/RULES.md](docs/RULES.md) for full calculation formulas.

## Important notes

**Must read**

1. After changing the extension, **reload** it in `chrome://extensions` and verify the version
2. Already-open tabs won't auto-update — close and reopen official + manager pages
3. **"Allow access to file URLs"** must be enabled
4. Must be logged into the official account
5. Unofficial tool — for personal reference only; trust official billing

**Troubleshooting**

| Symptom | Fix |
|---------|-----|
| Manager stuck on "waiting for sync" | Confirm green toast on official page first |
| Version unchanged | Remove extension, reload unpacked |
| Toast OK but sliders stuck | Close manager tab and reopen; check file URL permission |
| No green toast on official page | Confirm spending/billing page; hard-refresh |

**Privacy & behavior**

- Extension does not upload data to third-party servers
- Readings stay in local `chrome.storage.local`; managers use `localStorage`
- Scripts injected only on cursor.com / gemini.google.com
- Syncs when you open or refresh the official usage page; data stays in this browser

## Contributing

Issues and PRs welcome.

## License

[MIT](LICENSE) © 2026 xyl369
