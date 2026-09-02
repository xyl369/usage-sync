(function () {
  'use strict';

  /**
   * Official Billing table layout (2026-07):
   *   Cursor Models     150M tokens   24.6%   ← pool total, % on same row as title
   *     auto            ...             8.6%
   *     composer-2.5    ...
   *   Other Models      8.09M tokens  22.0%
   *     claude-opus-... ...
   * Old logic only scanned the next line and stopped at auto, missing pool totals.
   */

  function isAlive() {
    try { return !!(chrome.runtime && chrome.runtime.id); } catch (_) { return false; }
  }
  if (!isAlive()) return;

  let BUILD = '?';
  try { BUILD = chrome.runtime.getManifest().version; } catch (_) { return; }

  const TOAST_ID = 'usage-sync-toast';
  let lastSignature = '';
  let debounceTimer = null;
  let stopped = false;
  let lastFailToastAt = 0;

  function showToast(text, ok = true) {
    let el = document.getElementById(TOAST_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = TOAST_ID;
      el.style.cssText = [
        'position:fixed', 'z-index:2147483647', 'right:16px', 'bottom:16px',
        'max-width:380px', 'padding:10px 14px', 'border-radius:10px',
        'font:13px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif',
        'color:#fff', 'box-shadow:0 8px 24px rgba(0,0,0,.25)',
        'opacity:0', 'transform:translateY(8px)', 'transition:all .2s ease',
      ].join(';');
      document.documentElement.appendChild(el);
    }
    el.style.background = ok ? '#16825d' : '#c72e2e';
    el.textContent = text;
    requestAnimationFrame(() => {
      el.style.opacity = '1';
      el.style.transform = 'translateY(0)';
    });
    clearTimeout(el._hide);
    el._hide = setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(8px)';
    }, 4500);
  }

  function clampPct(n) {
    if (!Number.isFinite(n)) return null;
    return Math.max(0, Math.min(100, Math.round(n * 10) / 10));
  }

  function toLocalInput(d) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function calendarDays(a, b) {
    const start = new Date(a.getFullYear(), a.getMonth(), a.getDate());
    const end = new Date(b.getFullYear(), b.getMonth(), b.getDate());
    return Math.max(1, Math.round((end - start) / 86400000));
  }

  function findBillingCycle(text) {
    const range = text.match(
      /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2}),?\s+(\d{4})\s*[-–—to至]+\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2}),?\s+(\d{4})/i
    );
    if (range) {
      const start = new Date(`${range[1]} ${range[2]}, ${range[3]}`);
      const end = new Date(`${range[4]} ${range[5]}, ${range[6]}`);
      if (!isNaN(start) && !isNaN(end)) {
        end.setHours(23, 59, 0, 0);
        return { reset: toLocalInput(end), cycleDays: calendarDays(start, end) };
      }
    }
    const cn = text.match(
      /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*[-–—至到~\s]+(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/
    );
    if (cn) {
      const start = new Date(+cn[1], +cn[2] - 1, +cn[3]);
      const end = new Date(+cn[4], +cn[5] - 1, +cn[6], 23, 59, 0, 0);
      return { reset: toLocalInput(end), cycleDays: calendarDays(start, end) };
    }
    const cnShort = text.match(/至\s*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
    if (cnShort) {
      const end = new Date(+cnShort[1], +cnShort[2] - 1, +cnShort[3], 23, 59, 0, 0);
      if (!isNaN(end)) return { reset: toLocalInput(end), cycleDays: null };
    }
    return { reset: null, cycleDays: null };
  }

  const AUTO_START = /Cursor\s*Models?|光标模型|Cursor\s*模型|First[\s-]*Party/i;
  const AUTO_STOP = /Other\s*Models?|其他模型|其它模型|其他型号|Third[\s-]*Party/i;
  const API_START = /Other\s*Models?|其他模型|其它模型|其他型号|Third[\s-]*Party/i;
  const API_STOP = /Invoice|发票|API\s*Keys|密钥|Included Usage|包含用途|包含使用/i;

  /** Pool total is the largest % in that section (sub-model rows are always smaller). */
  function pctAfterLabelUntil(text, startRe, stopRe) {
    const src = String(text);
    const start = src.search(startRe);
    if (start < 0) return null;
    const from = src.slice(start);
    const stop = from.slice(1).search(stopRe);
    const region = stop >= 0 ? from.slice(0, stop + 1) : from.slice(0, 8000);
    const all = [...region.matchAll(/(\d+(?:\.\d+)?)\s*%/g)].map((m) => clampPct(parseFloat(m[1]))).filter((n) => n != null);
    if (!all.length) return null;
    return Math.max.apply(null, all);
  }

  function isBillingLikePath() {
    const p = location.pathname || '';
    const q = location.search || '';
    if (/\/dashboard\/(usage|billing|spending)/i.test(p)) return true;
    if (/\/dashboard\/?$/i.test(p) && /tab=(usage|billing|spending)/i.test(q)) return true;
    return /\/dashboard/i.test(p);
  }

  /** Whether this line is a sub-model row (not a pool total) */
  function isSubModelLine(line) {
    const t = line.trim();
    if (/composer-|claude-|gpt-|cursor-grok|gemini-|o[134]-|fable-|sonnet-|opus-/i.test(t)) return true;
    if (/^auto$/i.test(t) || /^auto\s+自动$/i.test(t)) return true;
    return false;
  }

  function isAutoPoolHeader(line) {
    const t = line.trim();
    if (/Keys|密钥|Invoice/i.test(t)) return false;
    // Prefer newer copy first
    if (/Cursor\s*Models?/i.test(t) || /Cursor\s*模型/i.test(t) || /光标模型/.test(t)) return true;
    if (/First[\s-]*Party(\s*Models?)?/i.test(t) || /第一方/i.test(t)) return true;
    if (/^Auto\s*\+?\s*Composer/i.test(t)) return true;
    return false;
  }

  function isApiPoolHeader(line) {
    const t = line.trim();
    if (/Keys|密钥|Invoice/i.test(t)) return false;
    if (/Other\s*Models?/i.test(t) || /其他模型|其它模型|其他型号/i.test(t)) return true;
    if (/Third[\s-]*Party/i.test(t) || /第三方/i.test(t)) return true;
    // Whole line is API / API Usage (do not match API Keys)
    if (/^API(\s*Usage)?$/i.test(t) || /^API\s*使用/i.test(t)) return true;
    // Same row: API 8.09M tokens 22.0%
    if (/^API(\s*Usage)?\b/i.test(t) && /\d+(?:\.\d+)?\s*%/.test(t) && !/Keys|密钥/i.test(t)) return true;
    return false;
  }

  function firstPctInLine(line) {
    const m = String(line).match(/(\d+(?:\.\d+)?)\s*%/);
    return m ? clampPct(parseFloat(m[1])) : null;
  }

  /** Extract the last percentage from a line (pool totals often in trailing Usage column) */
  function lastPctInLine(line) {
    const matches = String(line).match(/(\d+(?:\.\d+)?)\s*%/g);
    if (!matches || !matches.length) return null;
    const last = matches[matches.length - 1];
    const n = parseFloat(last);
    return clampPct(n);
  }

  /**
   * Find pool total %:
   * 1) Header row itself has % (same table row)
   * 2) First standalone xx% in following lines before sub-model detail gets too deep
   */
  function poolPct(lines, headerIdx) {
    const headerPct = firstPctInLine(lines[headerIdx]);
    if (headerPct != null) return headerPct;

    for (let j = headerIdx + 1; j < Math.min(lines.length, headerIdx + 8); j++) {
      const line = lines[j];
      if (isAutoPoolHeader(line) || isApiPoolHeader(line)) break;
      if (isSubModelLine(line)) {
        // Sub-model rows may be "auto 8.6%" — skip and keep looking for pool-level standalone % line
        if (!/^(\d+(?:\.\d+)?)\s*%$/.test(line.trim())) continue;
      }
      const bare = line.trim().match(/^(\d+(?:\.\d+)?)\s*%$/);
      if (bare) return clampPct(parseFloat(bare[1]));
      // "150M tokens" line — percentage may be on the next line (24.6%)
      if (/tokens|代币|万|亿/i.test(line)) continue;
      const p = lastPctInLine(line);
      if (p != null && !isSubModelLine(line)) return p;
    }
    return null;
  }

  /**
   * Spending page format (simpler, more reliable):
   *   Cursor Models · Includes Cursor Grok 4.5 and Composer 2.5     25% used
   *   Other Models                                                  22% used
   */
  function scrapeSpendingPage(bodyText) {
    const flat = bodyText.replace(/\s+/g, ' ');
    let auto = pctAfterLabelUntil(
      flat,
      /Cursor\s*Models?|光标模型|Cursor\s*模型|First[\s-]*Party/i,
      /Other\s*Models?|其他模型|其它模型|其他型号/i
    );
    let api = pctAfterLabelUntil(
      flat,
      /Other\s*Models?|其他模型|其它模型|其他型号/i,
      /Invoice|发票|API\s*Keys|密钥/i
    );

    if (/% used/i.test(flat)) {
      const autoM =
        flat.match(/Cursor\s*Models?[^%]{0,160}?(\d+(?:\.\d+)?)\s*%\s*used/i) ||
        flat.match(/光标模型[^%]{0,80}?(\d+(?:\.\d+)?)\s*%/);
      if (autoM) auto = clampPct(parseFloat(autoM[1]));
      const apiM = flat.match(/Other\s*Models?[^%]{0,160}?(\d+(?:\.\d+)?)\s*%\s*used/i);
      if (apiM) api = clampPct(parseFloat(apiM[1]));
    }

    if (auto == null && api == null) return null;
    return { auto, api, source: 'dom-spending' };
  }

  function scrapeDom() {
    const bodyText = document.body ? document.body.innerText : '';
    if (!bodyText || bodyText.length < 40) return null;

    const looksLike =
      /Included Usage|包含使用|包含用途|Cursor Models|光标模型|Other Models|其他模型|First-Party|第一方|API Usage|Usage/i.test(bodyText);
    if (!looksLike && !/\/dashboard\/(usage|billing|spending)/i.test(location.pathname)) return null;

    const flat = bodyText.replace(/\s+/g, ' ');
    let auto = pctAfterLabelUntil(flat, AUTO_START, AUTO_STOP);
    let api = pctAfterLabelUntil(flat, API_START, API_STOP);

    const spending = /% used/i.test(bodyText) ? scrapeSpendingPage(bodyText) : null;
    if (auto == null && spending?.auto != null) auto = spending.auto;
    if (api == null && spending?.api != null) api = spending.api;

    const lines = bodyText.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    if (auto == null || api == null) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (auto == null && isAutoPoolHeader(line)) auto = poolPct(lines, i);
        if (api == null && isApiPoolHeader(line)) api = poolPct(lines, i);
      }
    }

    const cycle = findBillingCycle(bodyText);
    if (auto == null && api == null) return null;
    return {
      auto,
      api,
      reset: cycle.reset,
      cycleDays: cycle.cycleDays,
      source: spending ? 'dom-spending' : 'dom-billing-v3',
    };
  }

  function queueSave(data) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => save(data), 200);
  }

  function save(data) {
    if (stopped || !data) return;
    if (!isAlive()) { stopped = true; return; }
    if (data.api == null && data.auto == null) return;

    const signature = `${data.auto}|${data.api}|${data.reset || ''}|${data.cycleDays || ''}`;
    if (signature === lastSignature) return;
    lastSignature = signature;

    const payload = {
      auto: data.auto,
      api: data.api,
      reset: data.reset || null,
      cycleDays: data.cycleDays || null,
      syncedAt: Date.now(),
      source: data.source || 'dom',
    };

    try {
      chrome.storage.local.set({ cursorSync: payload }, () => {
        try {
          if (!isAlive()) { stopped = true; return; }
          const a = data.auto != null ? `Cursor Models ${data.auto}%` : 'Cursor Models —';
          const p = data.api != null ? `Other Models ${data.api}%` : 'Other Models —';
          showToast(`[${BUILD}] Synced · ${a} · ${p}`);
        } catch (_) {
          stopped = true;
        }
      });
    } catch (_) {
      stopped = true;
    }
  }

  async function run() {
    if (stopped || !isAlive()) { stopped = true; return; }
    if (!isBillingLikePath()) return;

    const dom = scrapeDom();
    if (!dom) {
      const now = Date.now();
      if (/Included Usage|Cursor Models|Other Models/i.test(document.body?.innerText || '') &&
          now - lastFailToastAt > 12000) {
        lastFailToastAt = now;
        showToast(`[${BUILD}] Usage table visible but percentages not found — please hard-refresh this page`, false);
      }
      return;
    }
    queueSave(dom);
  }

  let obsTimer = null;
  const mo = new MutationObserver(() => {
    if (stopped) return;
    clearTimeout(obsTimer);
    obsTimer = setTimeout(run, 500);
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });

  run();
  setTimeout(run, 800);
  setTimeout(run, 2000);
  setTimeout(run, 5000);
  setInterval(() => { if (!stopped) run(); }, 8000);
})();
