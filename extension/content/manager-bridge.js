(function () {
  'use strict';

  /**
   * Root cause: Chrome content scripts are isolated from page JS.
   * window.applyCursorSync lives in the page world; it is always undefined in the content script,
   * so the banner could show correct chrome.storage values while sliders never updated.
   * Fix: inject a <script> into the page world to call hooks, and also write localStorage + dispatch input.
   */

  function isAlive() {
    try {
      return Boolean(chrome.runtime && chrome.runtime.id);
    } catch (_) {
      return false;
    }
  }

  if (!isAlive()) return;

  let BUILD = '1.4.0';
  try {
    BUILD = chrome.runtime.getManifest().version;
  } catch (_) { /* keep fallback */ }

  const path = decodeURIComponent(location.pathname || '');
  const title = document.title || '';
  const isDashboard = Boolean(
    (document.body && document.body.id === 'usage-dashboard') ||
    /\/managers\/index\.html$/i.test(path) ||
    /^Usage Sync$/i.test(title)
  );
  const isCursor =
    isDashboard ||
    /Cursor\s*Usage\s*Manager/i.test(title) ||
    /cursor-usage-manager/i.test(path);
  const isGemini =
    isDashboard ||
    /Gemini\s*Quota\s*Manager/i.test(title) ||
    /gemini-quota-manager/i.test(path);

  if (!isCursor && !isGemini) return;

  let stopped = false;
  let tickTimer = null;
  let lastCursorApplied = '';
  let lastGeminiApplied = '';

  function stop(reason) {
    if (stopped) return;
    stopped = true;
    if (tickTimer != null) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
    showBanner(reason || `[${BUILD}] Extension updated — close this tab and reopen the manager`, false);
  }

  function showBanner(text, ok = true) {
    try {
      let el = document.getElementById('usage-sync-banner');
      if (!el) {
        el = document.createElement('div');
        el.id = 'usage-sync-banner';
        // Prefer the page slot below the plan card to avoid stealing top-bar attention
        const slot = document.getElementById('usage-sync-slot');
        const host =
          slot ||
          document.querySelector('.page') ||
          document.querySelector('.container') ||
          document.body;
        if (!host) return;
        if (slot) {
          slot.appendChild(el);
          slot.hidden = false;
        } else {
          host.insertBefore(el, host.firstChild);
        }
      }
      el.className = 'usage-sync-banner ' + (ok ? 'is-ok' : 'is-wait');
      el.setAttribute('role', 'status');
      el.textContent = text;
    } catch (_) { /* ignore */ }
  }

  function fmtTime(ts) {
    if (!ts) return 'Never';
    try {
      return new Date(ts).toLocaleString('en-US', {
        month: 'numeric', day: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      });
    } catch (_) {
      return 'Unknown';
    }
  }

  /** Run in page JS world (bypass isolated world) */
  function runInPage(fnName, data) {
    const payload = JSON.stringify(data == null ? null : data);
    const code =
      'try{if(typeof window.' + fnName + '==="function"){window.' + fnName + '(' + payload + ');' +
      'document.documentElement.setAttribute("data-usage-sync-applied","' + fnName + ':"+Date.now());}}catch(e)' +
      '{document.documentElement.setAttribute("data-usage-sync-error",String(e&&e.message||e));}';
    const s = document.createElement('script');
    s.textContent = code;
    const root = document.documentElement || document.head || document.body;
    root.appendChild(s);
    s.remove();
  }

  function setSlider(id, value) {
    const el = document.getElementById(id);
    if (!el || value == null || !Number.isFinite(Number(value))) return false;
    el.value = String(value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  /** Dual-write DOM + localStorage; does not depend on page hooks */
  function applyCursorDom(data) {
    if (!data) return;
    if (data.auto != null && Number.isFinite(Number(data.auto))) {
      try { localStorage.setItem('cursorUsageAuto', String(data.auto)); } catch (_) {}
      setSlider('autoSlider', data.auto);
    }
    if (data.api != null && Number.isFinite(Number(data.api))) {
      try { localStorage.setItem('cursorUsageApi', String(data.api)); } catch (_) {}
      setSlider('apiSlider', data.api);
    }
    if (data.reset && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(data.reset)) {
      try { localStorage.setItem('cursorNextResetTime', data.reset.slice(0, 16)); } catch (_) {}
    }
    runInPage('applyCursorSync', data);
  }

  function applyGeminiDom(data) {
    if (!data) return;
    if (data.weekly != null && Number.isFinite(Number(data.weekly))) {
      const w = Math.round(Number(data.weekly));
      try { localStorage.setItem('geminiCurrentUsage', String(w)); } catch (_) {}
      setSlider('weeklyUsageSlider', w);
    }
    if (data.short != null && Number.isFinite(Number(data.short))) {
      try { localStorage.setItem('geminiShortUsage', String(data.short)); } catch (_) {}
    }
    if (data.weeklyReset && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(data.weeklyReset)) {
      try { localStorage.setItem('geminiBaseResetTime', data.weeklyReset.slice(0, 16)); } catch (_) {}
    }
    if (data.shortReset && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(data.shortReset)) {
      try { localStorage.setItem('geminiShortResetTime', data.shortReset.slice(0, 16)); } catch (_) {}
    }
    runInPage('applyGeminiSync', data);
  }

  /** Read actual slider values to confirm alignment (not just banner text) */
  function verifyCursor(data) {
    const autoEl = document.getElementById('autoSlider');
    const apiEl = document.getElementById('apiSlider');
    const autoOk = data.auto == null || (autoEl && Math.abs(Number(autoEl.value) - Number(data.auto)) < 0.15);
    const apiOk = data.api == null || (apiEl && Math.abs(Number(apiEl.value) - Number(data.api)) < 0.15);
    return Boolean(autoOk && apiOk);
  }

  function verifyGemini(data) {
    const weeklyEl = document.getElementById('weeklyUsageSlider');
    const weeklyOk = data.weekly == null ||
      (weeklyEl && Math.abs(Number(weeklyEl.value) - Math.round(Number(data.weekly))) < 0.5);
    const shortText = document.getElementById('shortUsageText');
    const shortOk = data.short == null ||
      (shortText && shortText.textContent.indexOf(String(Math.round(Number(data.short) * 10) / 10)) !== -1) ||
      (shortText && shortText.textContent.indexOf(String(Math.round(Number(data.short)))) !== -1);
    // Short read-only bar depends on page hook refresh; check data-usage-sync-applied if hook ran
    const hooked = document.documentElement.getAttribute('data-usage-sync-applied') || '';
    return Boolean(weeklyOk && (shortOk || /applyGeminiSync/.test(hooked)));
  }

  function applyCursorPayload(d) {
    if (!d) {
      return { ok: false, text: 'Cursor waiting — hard-refresh spending or billing' };
    }
    const sig = `${d.auto}|${d.api}|${d.reset}|${d.syncedAt}`;
    const aligned = verifyCursor(d);
    if (sig !== lastCursorApplied || !aligned) {
      applyCursorDom(d);
      lastCursorApplied = sig;
    }
    const parts = [];
    if (d.auto != null) parts.push(`Cursor Models ${d.auto}%`);
    if (d.api != null) parts.push(`Other Models ${d.api}%`);
    const okNow = verifyCursor(d);
    if (!okNow) {
      applyCursorDom(d);
      return { ok: false, text: 'Cursor retrying · ' + parts.join(' · ') };
    }
    return { ok: true, text: 'Cursor ' + parts.join(' · ') + ' · ' + fmtTime(d.syncedAt) };
  }

  function applyGeminiPayload(d) {
    if (!d) {
      return { ok: false, text: 'Gemini waiting — refresh gemini.google.com/usage' };
    }
    const sig = `${d.short}|${d.weekly}|${d.shortReset}|${d.weeklyReset}|${d.syncedAt}`;
    const aligned = verifyGemini(d);
    if (sig !== lastGeminiApplied || !aligned) {
      applyGeminiDom(d);
      lastGeminiApplied = sig;
    }
    const parts = [];
    if (d.short != null) parts.push(`Current ${d.short}%`);
    if (d.weekly != null) parts.push(`Weekly ${d.weekly}%`);
    const okNow = verifyGemini(d);
    if (!okNow) {
      applyGeminiDom(d);
      return { ok: false, text: 'Gemini retrying · ' + parts.join(' · ') };
    }
    return { ok: true, text: 'Gemini ' + parts.join(' · ') + ' · ' + fmtTime(d.syncedAt) };
  }

  function applyPayload(r) {
    const store = r || {};
    if (isDashboard) {
      const cursor = applyCursorPayload(store.cursorSync);
      const gemini = applyGeminiPayload(store.geminiSync);
      const ok = cursor.ok && gemini.ok;
      showBanner('[' + BUILD + '] ' + cursor.text + ' · ' + gemini.text, ok);
      return;
    }

    if (isCursor) {
      const cursor = applyCursorPayload(store.cursorSync);
      showBanner('[' + BUILD + '] ' + (cursor.ok ? 'Aligned · ' : '') + cursor.text, cursor.ok);
      return;
    }

    if (isGemini) {
      const gemini = applyGeminiPayload(store.geminiSync);
      showBanner('[' + BUILD + '] ' + (gemini.ok ? 'Aligned · ' : '') + gemini.text, gemini.ok);
    }
  }

  function pull() {
    if (stopped) return;
    if (!isAlive()) {
      stop(`[${BUILD}] Extension updated — close this tab and reopen the manager`);
      return;
    }
    try {
      chrome.storage.local.get(['cursorSync', 'geminiSync'], (r) => {
        if (stopped) return;
        try {
          if (!isAlive()) {
            stop(`[${BUILD}] Extension updated — close this tab and reopen the manager`);
            return;
          }
          applyPayload(r || {});
        } catch (_) {
          stop(`[${BUILD}] Extension updated — close this tab and reopen the manager`);
        }
      });
    } catch (_) {
      stop(`[${BUILD}] Extension updated — close this tab and reopen the manager`);
    }
  }

  function onStorageChanged(changes, area) {
    if (stopped || area !== 'local') return;
    if (!isAlive()) {
      stop(`[${BUILD}] Extension updated — close this tab and reopen the manager`);
      return;
    }
    if (isCursor && changes.cursorSync) {
      lastCursorApplied = '';
      pull();
    }
    if (isGemini && changes.geminiSync) {
      lastGeminiApplied = '';
      pull();
    }
  }

  try {
    chrome.storage.onChanged.addListener(onStorageChanged);
  } catch (_) {
    stop(`[${BUILD}] Cannot access storage — enable “Allow access to file URLs”`);
    return;
  }

  // Page hooks may register after content script: pull again after delay
  pull();
  setTimeout(pull, 300);
  setTimeout(pull, 1000);
  tickTimer = setInterval(pull, 4000);
})();
