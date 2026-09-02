(function () {
  'use strict';

  function isAlive() {
    try { return !!(chrome.runtime && chrome.runtime.id); } catch (_) { return false; }
  }
  if (!isAlive()) return;

  let BUILD = '?';
  try { BUILD = chrome.runtime.getManifest().version; } catch (_) { return; }

  const TOAST_ID = 'usage-sync-toast-gemini';
  let lastSignature = '';
  let debounceTimer = null;
  let stopped = false;

  function showToast(text, ok = true) {
    let el = document.getElementById(TOAST_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = TOAST_ID;
      el.style.cssText = [
        'position:fixed', 'z-index:2147483647', 'right:16px', 'bottom:16px',
        'max-width:360px', 'padding:10px 14px', 'border-radius:10px',
        'font:13px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif',
        'color:#fff', 'box-shadow:0 8px 24px rgba(0,0,0,.3)',
        'opacity:0', 'transform:translateY(8px)', 'transition:all .2s ease',
      ].join(';');
      document.documentElement.appendChild(el);
    }
    el.style.background = ok ? '#4f46e5' : '#c72e2e';
    el.textContent = text;
    requestAnimationFrame(() => {
      el.style.opacity = '1';
      el.style.transform = 'translateY(0)';
    });
    clearTimeout(el._hide);
    el._hide = setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(8px)';
    }, 3200);
  }

  function clampPct(n) {
    if (!Number.isFinite(n)) return null;
    return Math.max(0, Math.min(100, Math.round(n * 10) / 10));
  }

  function toLocalInput(d) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function parseClockToLocal(clock, now = new Date()) {
    const m = String(clock).match(/(\d{1,2}):(\d{2})/);
    if (!m) return null;
    const d = new Date(now);
    d.setSeconds(0, 0);
    d.setHours(+m[1], +m[2], 0, 0);
    // Short window resets every 5h; if clock already passed, keep today's stamp
    // (manager advances on 5h cadence). Only bump to tomorrow if clearly overnight past.
    if (d.getTime() < now.getTime() - 5 * 3600 * 1000) {
      d.setDate(d.getDate() + 1);
    }
    return toLocalInput(d);
  }

  function parseChineseDateTime(str, now = new Date()) {
    const m = String(str).match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*(\d{1,2}):(\d{2})/);
    if (!m) return null;
    let year = now.getFullYear();
    const d = new Date(year, +m[1] - 1, +m[2], +m[3], +m[4], 0, 0);
    if (d.getTime() < now.getTime() - 40 * 86400000) d.setFullYear(year + 1);
    return toLocalInput(d);
  }

  /**
   * Official layout:
   *   Current usage → Used X% → Reset: HH:MM
   *   Weekly limit → Used Y% → Reset: localized date + HH:MM
   * Never take % from a parent that spans both sections.
   */
  function scrape() {
    const path = location.pathname || '';
    const bodyText = document.body ? document.body.innerText : '';
    const looksUsage =
      /\/usage/i.test(path) ||
      /用量限额|当前用量|每周限额|Usage limit|Weekly/i.test(bodyText);
    if (!looksUsage) return null;

    let short = null;
    let weekly = null;
    let shortReset = null;
    let weeklyReset = null;

    // --- Primary: section-split on plain text ---
    const norm = bodyText.replace(/\r/g, '');
    const weeklySplit = norm.split(/(?:每周限额|Weekly\s*limit)/i);
    const beforeWeekly = weeklySplit[0] || '';
    const afterWeekly = weeklySplit.slice(1).join('\n') || '';

    const shortSec = beforeWeekly.split(/(?:当前用量|Current\s*usage)/i).pop() || beforeWeekly;
    const mShort = shortSec.match(/已使用\s*(\d+(?:\.\d+)?)\s*%/) ||
      shortSec.match(/Used\s*(\d+(?:\.\d+)?)\s*%/i) ||
      shortSec.match(/(?:Used|Usage)[:\s]*(\d+(?:\.\d+)?)\s*%/i);
    if (mShort) short = clampPct(+mShort[1]);

    const mWeekly = afterWeekly.match(/已使用\s*(\d+(?:\.\d+)?)\s*%/) ||
      afterWeekly.match(/Used\s*(\d+(?:\.\d+)?)\s*%/i) ||
      afterWeekly.match(/(?:Used|Usage)[:\s]*(\d+(?:\.\d+)?)\s*%/i);
    if (mWeekly) weekly = clampPct(+mWeekly[1]);

    // Reset in short section: clock only
    const clock = shortSec.match(/重置时间\s*[:：]?\s*(\d{1,2}:\d{2})/);
    if (clock) shortReset = parseClockToLocal(clock[1]);

    // Reset in weekly section: prefer dated
    const dated = afterWeekly.match(/重置时间\s*[:：]?\s*([^\n]+)/);
    if (dated) {
      weeklyReset = parseChineseDateTime(dated[1]) || null;
      if (!weeklyReset) {
        const onlyClock = dated[1].match(/(\d{1,2}:\d{2})/);
        // ignore pure clock for weekly
      }
    }
    if (!weeklyReset) {
      const m = afterWeekly.match(/(\d{1,2}\s*月\s*\d{1,2}\s*日\s*\d{1,2}:\d{2})/);
      if (m) weeklyReset = parseChineseDateTime(m[1]);
    }

    // --- Fallback: ordered Used% under explicit headers via tight regex ---
    if (short == null) {
      const m = norm.match(/当前用量[\s\S]{0,200}?已使用\s*(\d+(?:\.\d+)?)\s*%/);
      if (m) short = clampPct(+m[1]);
    }
    if (weekly == null) {
      const m = norm.match(/每周限额[\s\S]{0,200}?已使用\s*(\d+(?:\.\d+)?)\s*%/);
      if (m) weekly = clampPct(+m[1]);
    }

    // Sanity: if both equal and page has two different Used% values, re-read ordered
    const allUsed = [...norm.matchAll(/已使用[\s\S]{0,24}(\d+(?:\.\d+)?)\s*%/g)].map((m) => clampPct(+m[1]));
    if (/当前用量/.test(norm) && /每周限额/.test(norm) && allUsed.length >= 2) {
      short = allUsed[0];
      weekly = allUsed[1];
    } else if (allUsed.length >= 2) {
      if (short == null) short = allUsed[0];
      if (weekly == null) weekly = allUsed[1];
      if (short != null && weekly != null && short === weekly && allUsed[0] !== allUsed[1]) {
        short = allUsed[0];
        weekly = allUsed[1];
      }
    }

    if (short == null && weekly == null) return null;
    return { short, weekly, shortReset, weeklyReset };
  }

  function queueSave(data) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => save(data), 350);
  }

  function save(data) {
    if (stopped || !data) return;
    if (!isAlive()) { stopped = true; return; }
    const signature = `${data.short}|${data.weekly}|${data.shortReset}|${data.weeklyReset}`;
    if (signature === lastSignature) return;
    lastSignature = signature;

    const payload = {
      short: data.short,
      weekly: data.weekly,
      shortReset: data.shortReset || null,
      weeklyReset: data.weeklyReset || null,
      syncedAt: Date.now(),
      source: 'dom-usage',
    };

    try {
      chrome.storage.local.set({ geminiSync: payload }, () => {
        try {
          if (!isAlive()) { stopped = true; return; }
          const parts = [];
          if (data.short != null) parts.push(`Current usage ${data.short}%`);
          if (data.weekly != null) parts.push(`Weekly limit ${data.weekly}%`);
          showToast(`[${BUILD}] Synced · ` + parts.join(' · '));
        } catch (_) {
          stopped = true;
        }
      });
    } catch (_) {
      stopped = true;
    }
  }

  function run() {
    if (stopped || !isAlive()) { stopped = true; return; }
    const data = scrape();
    if (data) queueSave(data);
  }

  let obsTimer = null;
  const mo = new MutationObserver(() => {
    if (stopped) return;
    clearTimeout(obsTimer);
    obsTimer = setTimeout(run, 700);
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });

  run();
  setInterval(() => { if (!stopped) run(); }, 10000);
})();
