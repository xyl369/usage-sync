importScripts('silent-refresh.js');

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    syncMeta: { installedAt: Date.now(), version: chrome.runtime.getManifest().version },
  });
});

/** Content scripts write storage directly; this only updates the badge */
function pushLocalHub() {
  chrome.storage.local.get(['cursorSync', 'geminiSync'], (r) => {
    fetch('http://127.0.0.1:18765/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cursorSync: r.cursorSync || null,
        geminiSync: r.geminiSync || null,
      }),
    }).catch(() => { /* HUD companion is optional */ });
  });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.cursorSync && changes.cursorSync.newValue) {
    updateBadge('cursor', changes.cursorSync.newValue);
  }
  if (changes.geminiSync && changes.geminiSync.newValue) {
    updateBadge('gemini', changes.geminiSync.newValue);
  }
  if (changes.cursorSync || changes.geminiSync) pushLocalHub();
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
    if (msg?.type === 'REFRESH_ALL') {
      refreshAll().then((result) => {
        try { sendResponse(result); } catch (_) { /* ignore */ }
      }).catch((e) => {
        try {
          sendResponse({
            ok: false,
            cursor: { ok: false, error: String(e && e.message || e) },
            gemini: { ok: false, error: String(e && e.message || e) },
          });
        } catch (_) { /* ignore */ }
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
