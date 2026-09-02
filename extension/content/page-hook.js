(function () {
  'use strict';
  function onApply(e) {
    const d = e && e.detail;
    if (!d || !d.fn) return;
    try {
      if (d.fn === 'applyCursorSync' && typeof window.applyCursorSync === 'function') {
        window.applyCursorSync(d.data);
      }
      if (d.fn === 'applyGeminiSync' && typeof window.applyGeminiSync === 'function') {
        window.applyGeminiSync(d.data);
      }
      if (d.fn === 'applyBundle' && typeof window.__usageHubApply === 'function') {
        window.__usageHubApply(d.data);
      }
    } catch (_) { /* ignore */ }
  }
  document.addEventListener('usage-sync-apply', onApply, true);
  window.addEventListener('usage-sync-apply', onApply, true);
})();
