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

  let BUILD = '1.5.1';
  try {
    BUILD = chrome.runtime.getManifest().version;
  } catch (_) { /* keep fallback */ }

  const path = decodeURIComponent(location.pathname || '');
  const title = document.title || '';
  function has(id) {
    return Boolean(document.getElementById(id));
  }
  const hasCursorSliders = has('autoSlider') || has('cAuto');
  const hasGeminiSliders = has('weeklyUsageSlider') || has('gWeekSlider');
  const isDashboard = Boolean(
    has('usage-sync-slot') ||
    (document.body && document.body.id === 'usage-dashboard') ||
    /\/managers\/index\.html$/i.test(path) ||
    /用量看板/i.test(path) ||
    /Usage Sync|用量看板|^用量$/i.test(title)
  );
  const isCursor =
    isDashboard ||
    hasCursorSliders ||
    /Cursor\s*Usage\s*Manager/i.test(title) ||
    /cursor-usage-manager/i.test(path);
  const isGemini =
    isDashboard ||
    hasGeminiSliders ||
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
    try {
      document.documentElement.setAttribute('data-usage-sync', BUILD);
      document.dispatchEvent(new CustomEvent('usage-sync-apply', {
        bubbles: true,
        cancelable: true,
        detail: { fn: fnName, data: data },
      }));
    } catch (_) { /* ignore */ }
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

  function setSlider(ids, value) {
    const list = Array.isArray(ids) ? ids : [ids];
    let ok = false;
    for (let i = 0; i < list.length; i++) {
      const el = document.getElementById(list[i]);
      if (!el || value == null || !Number.isFinite(Number(value))) continue;
      el.value = String(value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      ok = true;
    }
    return ok;
  }

  function readSlider(ids) {
    const list = Array.isArray(ids) ? ids : [ids];
    for (let i = 0; i < list.length; i++) {
      const el = document.getElementById(list[i]);
      if (el && Number.isFinite(Number(el.value))) return Number(el.value);
    }
    return null;
  }

  function setText(ids, text) {
    const list = Array.isArray(ids) ? ids : [ids];
    for (let i = 0; i < list.length; i++) {
      const el = document.getElementById(list[i]);
      if (el) el.textContent = text;
    }
  }

  /** Dual-write DOM + localStorage; does not depend on page hooks */
  function applyCursorDom(data) {
    if (!data) return;
    if (data.auto != null && Number.isFinite(Number(data.auto))) {
      try { localStorage.setItem('cursorUsageAuto', String(data.auto)); } catch (_) {}
      setSlider(['autoSlider', 'cAuto'], data.auto);
    }
    if (data.api != null && Number.isFinite(Number(data.api))) {
      try { localStorage.setItem('cursorUsageApi', String(data.api)); } catch (_) {}
      setSlider(['apiSlider', 'cApi'], data.api);
    }
    if (data.reset && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(data.reset)) {
      try { localStorage.setItem('cursorNextResetTime', data.reset.slice(0, 16)); } catch (_) {}
    }
    if (data.cycleDays != null && Number.isFinite(Number(data.cycleDays)) && Number(data.cycleDays) > 0) {
      try { localStorage.setItem('cursorCycleDays', String(Math.round(Number(data.cycleDays)))); } catch (_) {}
    }
    runInPage('applyCursorSync', data);
  }

  function applyGeminiDom(data) {
    if (!data) return;
    if (data.weekly != null && Number.isFinite(Number(data.weekly))) {
      const w = Math.max(0, Math.min(100, Math.round(Number(data.weekly) * 10) / 10));
      try { localStorage.setItem('geminiCurrentUsage', String(w)); } catch (_) {}
      setSlider(['weeklyUsageSlider', 'gWeekSlider'], w);
    }
    if (data.short != null && Number.isFinite(Number(data.short))) {
      const s = Math.max(0, Math.min(100, Math.round(Number(data.short) * 10) / 10));
      try { localStorage.setItem('geminiShortUsage', String(s)); } catch (_) {}
      const label = String(s);
      setText(['shortUsageText', 'gShort'], label.replace(/\.0$/, '') + '%');
    }
    if (data.weeklyReset && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(data.weeklyReset)) {
      try { localStorage.setItem('geminiBaseResetTime', data.weeklyReset.slice(0, 16)); } catch (_) {}
    }
    if (data.shortReset && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(data.shortReset)) {
      try { localStorage.setItem('geminiShortResetTime', data.shortReset.slice(0, 16)); } catch (_) {}
    }
    runInPage('applyGeminiSync', data);
  }

  function near(a, b, tol) {
    return a != null && Number.isFinite(Number(a)) && Math.abs(Number(a) - Number(b)) < tol;
  }

  function verifyCursor(data) {
    const autoEl = readSlider(['autoSlider', 'cAuto']);
    const apiEl = readSlider(['apiSlider', 'cApi']);
    let autoLs = NaN, apiLs = NaN;
    try {
      autoLs = parseFloat(localStorage.getItem('cursorUsageAuto'));
      apiLs = parseFloat(localStorage.getItem('cursorUsageApi'));
    } catch (_) { /* ignore */ }
    const autoOk = data.auto == null || near(autoEl, data.auto, 0.15) || near(autoLs, data.auto, 0.15);
    const apiOk = data.api == null || near(apiEl, data.api, 0.15) || near(apiLs, data.api, 0.15);
    return Boolean(autoOk && apiOk);
  }

  function verifyGemini(data) {
    const weeklyEl = readSlider(['weeklyUsageSlider', 'gWeekSlider']);
    let weekLs = NaN, shortLs = NaN;
    try {
      weekLs = parseFloat(localStorage.getItem('geminiCurrentUsage'));
      shortLs = parseFloat(localStorage.getItem('geminiShortUsage'));
    } catch (_) { /* ignore */ }
    const weeklyOk = data.weekly == null ||
      near(weeklyEl, data.weekly, 0.6) ||
      near(weekLs, data.weekly, 0.6);
    const shortText = document.getElementById('shortUsageText') || document.getElementById('gShort');
    const shortOk = data.short == null ||
      near(shortLs, data.short, 0.6) ||
      (shortText && shortText.textContent.indexOf(String(Math.round(Number(data.short) * 10) / 10)) !== -1) ||
      (shortText && shortText.textContent.indexOf(String(Math.round(Number(data.short)))) !== -1);
    const hooked = document.documentElement.getAttribute('data-usage-sync-applied') || '';
    return Boolean(weeklyOk && (shortOk || /applyGeminiSync/.test(hooked)));
  }

  function applyCursorPayload(d) {
    if (!d) {
      return { ok: false, text: 'Cursor waiting — hard-refresh spending or billing' };
    }
    const sig = `${d.auto}|${d.api}|${d.reset}|${d.cycleDays}|${d.syncedAt}`;
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
    document.documentElement.setAttribute('data-usage-sync', BUILD);
  } catch (_) { /* ignore */ }

  function isZh() {
    return ((document.documentElement.lang || '').indexOf('zh') === 0) ||
      /用量/.test(document.title || '');
  }

  function refreshCopy(res) {
    const zh = isZh();
    if (!res) {
      return zh ? '刷新失败' : 'Refresh failed';
    }
    const c = res.cursor || {};
    const g = res.gemini || {};
    const cPart = c.ok
      ? (zh
        ? ('Cursor 模型 ' + c.auto + '% / 其他 ' + c.api + '%')
        : ('Cursor Models ' + c.auto + '% / Other ' + c.api + '%'))
      : (zh
        ? ('Cursor 失败' + (c.error === 'auth' || c.error === 'not-signed-in' ? '（未登录）' : ''))
        : ('Cursor failed' + (c.error === 'auth' || c.error === 'not-signed-in' ? ' (signed out)' : '')));
    const gPart = g.ok
      ? (zh
        ? ('Gemini 当前 ' + g.short + '% / 每周 ' + g.weekly + '%')
        : ('Gemini current ' + g.short + '% / weekly ' + g.weekly + '%'))
      : (zh
        ? ('Gemini 失败' + (g.error === 'auth' || g.error === 'not-signed-in' ? '（未登录）' : ''))
        : ('Gemini failed' + (g.error === 'auth' || g.error === 'not-signed-in' ? ' (signed out)' : '')));
    return (zh ? '已刷新 · ' : 'Refreshed · ') + cPart + ' · ' + gPart;
  }

  function setRefreshBusy(on) {
    document.querySelectorAll('#usageRefresh, [data-usage-refresh]').forEach((btn) => {
      btn.classList.toggle('is-busy', on);
      btn.disabled = on;
    });
  }

  let refreshLock = false;
  function requestRefresh() {
    if (stopped || refreshLock) return;
    if (!isAlive()) {
      stop(`[${BUILD}] Extension updated — close this tab and reopen the manager`);
      return;
    }
    refreshLock = true;
    setRefreshBusy(true);
    showBanner('[' + BUILD + '] ' + (isZh() ? '正在静默刷新 Cursor 和 Gemini…' : 'Refreshing Cursor and Gemini…'), false);
    try {
      chrome.runtime.sendMessage({ type: 'REFRESH_ALL' }, (res) => {
        refreshLock = false;
        setRefreshBusy(false);
        if (!isAlive() || chrome.runtime.lastError) {
          showBanner('[' + BUILD + '] ' + (isZh()
            ? '扩展未连接。请加载 Usage Sync 并允许访问文件网址。'
            : 'Extension not connected. Load Usage Sync and allow file URL access.'), false);
          return;
        }
        lastCursorApplied = '';
        lastGeminiApplied = '';
        pull();
        showBanner('[' + BUILD + '] ' + refreshCopy(res), !!(res && res.ok));
      });
    } catch (_) {
      refreshLock = false;
      setRefreshBusy(false);
      showBanner('[' + BUILD + '] ' + (isZh() ? '扩展未连接' : 'Extension not connected'), false);
    }
  }

  document.addEventListener('click', (e) => {
    const btn = e.target && e.target.closest && e.target.closest('#usageRefresh, [data-usage-refresh]');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    requestRefresh();
  }, true);

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
