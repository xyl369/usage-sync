# Usage Sync Rules

## 1. Official data → local fields

The extension scrapes percentages from official pages into `chrome.storage.local`; local HTML dashboards read them into sliders.

Primary UI: `managers/index.html` (Cursor + Gemini). Standalone pages still work:

- `managers/cursor-usage-manager.html`
- `managers/gemini-quota-manager.html`

### Cursor

| Official page | Official field | Local manager | Slider ID |
|---------------|----------------|---------------|-----------|
| [spending](https://cursor.com/dashboard/spending) or [billing](https://cursor.com/dashboard/billing) | **Cursor Models** / **光标模型** pool `XX%` (not sub-model rows) | Cursor Models | `#autoSlider` |
| Same | **Other Models** / **其他模型** pool `XX%` | Other Models | `#apiSlider` |
| Billing cycle line | `August 18, 2026 – September 18, 2026` | Next reset + cycle days | `cursorNextResetTime`, `cursorCycleDays` |

> Legacy labels First-Party / API Usage renamed to Cursor Models / Other Models. Extension v1.3.5+ supports both.

### Gemini

| Official page | Official field | Local manager |
|---------------|----------------|---------------|
| [gemini.google.com/usage](https://gemini.google.com/usage) | **Weekly limit** % | Weekly slider `#weeklyUsageSlider` |
| Same | **Current usage** % (5h window) | Short-cycle read-only bar |
| Same | Reset time | `geminiBaseResetTime` / `geminiShortResetTime` |

## 2. Cursor calculation rules

**Weighted Total (not simple average)**

```
Total ≈ round( (Auto × W_auto + API × W_api) / (W_auto + W_api) )
```

Defaults: W_auto = 3.5, W_api = 1. Example: Auto 18.7%, API 22% → Total ≈ 19%

**Time progress** = elapsed time in billing cycle / total cycle duration × 100%

**Ideal line (black marker)**

- Total ideal = time progress T
- Auto/API ideal lines: allocated under weighted constraint based on current usage ratio

**Over-limit detection**

| Condition | Display |
|-----------|---------|
| Usage > ideal line | Yellow, "ahead by X%" |
| Usage ≤ ideal line | Green "on track" / "behind" |
| Any item = 100% | Exhausted, wait for reset |

## 3. Gemini calculation rules

| Cycle | Official mapping | Notes |
|-------|------------------|-------|
| 5-hour window | Current usage | Read-only, updates on page refresh |
| 7-day cycle | Weekly limit | Adjustable slider |

Ideal line = expected usage linearly scaled by elapsed time in the cycle.

## 4. Sync mechanism

```
Official page refresh → cursor.js/gemini.js scrapes DOM
→ writes to chrome.storage.local
→ manager-bridge.js injects into page world
→ applyCursorSync / applyGeminiSync
→ updates sliders + localStorage
```

**Key:** Chrome content scripts are isolated from page JS. Bridge must inject `<script>` to call page hooks (see `manager-bridge.js`).

## 5. Notes

1. Unofficial tool — trust official billing
2. Must be logged into official account
3. Reload extension + hard-refresh after code changes
4. "Allow access to file URLs" required
5. Readings update when you open / refresh the official usage page
