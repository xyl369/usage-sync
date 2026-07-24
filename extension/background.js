chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    syncMeta: { installedAt: Date.now(), version: chrome.runtime.getManifest().version },
  });
});

/** Content scripts write storage directly; this only updates the badge */
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.cursorSync && changes.cursorSync.newValue) {
    updateBadge('cursor', changes.cursorSync.newValue);
  }
  if (changes.geminiSync && changes.geminiSync.newValue) {
    updateBadge('gemini', changes.geminiSync.newValue);
  }
});

/** Backward-compatible sendMessage handler (if any legacy calls remain) */
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  try {
    if (msg?.type === 'SAVE_SYNC') {
      const key = msg.provider === 'gemini' ? 'geminiSync' : 'cursorSync';
      const payload = {
        ...msg.data,
        syncedAt: Date.now(),
        source: msg.source || 'unknown',
      };
      chrome.storage.local.set({ [key]: payload }, () => {
        updateBadge(msg.provider, payload);
        try { sendResponse({ ok: true }); } catch (_) { /* ignore */ }
      });
      return true;
    }
    if (msg?.type === 'GET_SYNC') {
      chrome.storage.local.get(['cursorSync', 'geminiSync'], (r) => {
        try { sendResponse(r); } catch (_) { /* ignore */ }
      });
      return true;
    }
  } catch (_) {
    /* ignore */
  }
  return false;
});

function updateBadge(provider, payload) {
  if (!payload) return;
  const auto = payload.auto ?? payload.weekly;
  const api = payload.api ?? payload.short;
  let text = '';
  if (provider === 'cursor' && Number.isFinite(auto) && Number.isFinite(api)) {
    text = String(Math.round((auto + api) / 2));
  } else if (provider === 'gemini' && Number.isFinite(payload.weekly)) {
    text = String(Math.round(payload.weekly));
  }
  if (text) {
    chrome.action.setBadgeText({ text: text.length > 3 ? text.slice(0, 3) : text });
    chrome.action.setBadgeBackgroundColor({
      color: provider === 'gemini' ? '#6366f1' : '#16825d',
    });
  }
}
