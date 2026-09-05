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
    }
    if (!weeklyReset) {
      const m = afterWeekly.match(/(\d{1,2}\s*月\s*\d{1,2}\s*日\s*\d{1,2}:\d{2})/);
      if (m) weeklyReset = parseChineseDateTime(m[1]);
    }

    // Fallback only when a section is still missing. Do not overwrite a good split
    // with the 2nd "已使用" on the page (promo / extra buckets can sit in between).
    if (short == null) {
      const m = norm.match(/当前用量[\s\S]{0,400}?已使用\s*(\d+(?:\.\d+)?)\s*%/) ||
        norm.match(/Current\s*usage[\s\S]{0,400}?Used\s*(\d+(?:\.\d+)?)\s*%/i);
      if (m) short = clampPct(+m[1]);
    }
    if (weekly == null) {
      const m = norm.match(/每周限额[\s\S]{0,400}?已使用\s*(\d+(?:\.\d+)?)\s*%/) ||
        norm.match(/Weekly\s*limit[\s\S]{0,400}?Used\s*(\d+(?:\.\d+)?)\s*%/i);
      if (m) weekly = clampPct(+m[1]);
    }

    if (short == null && weekly == null) return null;
    return { short, weekly, shortReset, weeklyReset, source: 'dom-usage' };
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

  function readWizTokens() {
    try {
      const s = document.createElement('script');
      s.textContent =
        'document.documentElement.setAttribute("data-usage-wiz",JSON.stringify({' +
        'at:(window.WIZ_global_data||{}).SNlM0e||"",' +
        'bl:(window.WIZ_global_data||{}).cfb2h||"",' +
        'fsid:(window.WIZ_global_data||{}).FdrFJe||""}));';
      const root = document.documentElement;
      root.appendChild(s);
      s.remove();
      return JSON.parse(root.getAttribute('data-usage-wiz') || '{}');
    } catch (_) {
      return {};
    }
  }

  function matchBracket(s, start) {
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < s.length; i++) {
      const ch = s[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
      } else if (ch === '"') inStr = true;
      else if (ch === '[') depth++;
      else if (ch === ']') {
        depth--;
        if (depth === 0) return i;
      }
    }
    return -1;
  }

  function toUsagePct(raw) {
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return null;
    if (raw <= 1.5) return clampPct(raw * 100);
    if (raw <= 100) return clampPct(raw);
    return null;
  }

  function pairByReset(metrics) {
    if (!metrics.length) return null;
    metrics.sort((a, b) => a.epoch - b.epoch);
    if (metrics.length === 1) {
      const hours = (metrics[0].epoch * 1000 - Date.now()) / 3600000;
      if (hours <= 8) return { short: metrics[0], weekly: null };
      return { short: null, weekly: metrics[0] };
    }
    return { short: metrics[0], weekly: metrics[metrics.length - 1] };
  }

  function walkMetrics(node, out) {
    if (!Array.isArray(node)) return;
    if (node.length >= 4 && typeof node[1] === 'number' && typeof node[2] === 'number' &&
        Array.isArray(node[3]) && Array.isArray(node[3][0]) && typeof node[3][0][0] === 'number') {
      const percent = toUsagePct(node[1]);
      const epoch = node[3][0][0];
      if (percent != null && epoch >= 1600000000) {
        out.push({ percent, epoch, period: node[2] });
      }
      return;
    }
    for (let i = 0; i < node.length; i++) walkMetrics(node[i], out);
  }

  function parseRpcUsage(text) {
    const src = String(text || '');
    let idx = 0;
    while (idx < src.length) {
      const at = src.indexOf('[["wrb.fr"', idx);
      if (at < 0) break;
      const end = matchBracket(src, at);
      if (end < 0) break;
      try {
        const rows = JSON.parse(src.slice(at, end + 1));
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          if (!Array.isArray(row) || row[0] !== 'wrb.fr' || typeof row[2] !== 'string') continue;
          let payload;
          try { payload = JSON.parse(row[2]); } catch (_) { continue; }
          const found = [];
          walkMetrics(payload, found);
          const paired = pairByReset(found);
          if (!paired || (!paired.short && !paired.weekly)) continue;
          return {
            short: paired.short ? paired.short.percent : null,
            weekly: paired.weekly ? paired.weekly.percent : null,
            shortReset: paired.short ? toLocalInput(new Date(paired.short.epoch * 1000)) : null,
            weeklyReset: paired.weekly ? toLocalInput(new Date(paired.weekly.epoch * 1000)) : null,
            source: 'rpc-' + row[1],
          };
        }
      } catch (_) { /* skip */ }
      idx = end + 1;
    }
    return null;
  }

  async function replayUsageRpc() {
    const wiz = readWizTokens();
    if (!wiz.at) return null;
    const rpcid = 'jSf9Qc';
    const freq = JSON.stringify([[[rpcid, '[]', null, 'generic']]]);
    const body = 'f.req=' + encodeURIComponent(freq) + '&at=' + encodeURIComponent(wiz.at) + '&';
    const reqid = 100000 + Math.floor(Math.random() * 800000);
    const prefix = (location.pathname.match(/^\/u\/\d+(?=\/|$)/) || [''])[0];
    const sourcePath = prefix + '/usage';
    const url =
      location.origin + prefix +
      '/_/BardChatUi/data/batchexecute?rpcids=' + encodeURIComponent(rpcid) +
      '&source-path=' + encodeURIComponent(sourcePath) +
      '&bl=' + encodeURIComponent(wiz.bl || '') +
      '&f.sid=' + encodeURIComponent(wiz.fsid || '') +
      '&hl=en&_reqid=' + reqid + '&rt=c';
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body,
      credentials: 'include',
    });
    if (!res.ok) return null;
    return parseRpcUsage(await res.text());
  }

  try {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (!msg || msg.type !== 'SCRAPE_NOW') return;
      (async () => {
        try {
          const onUsage = /\/usage(?:\/|$)/i.test(location.pathname || '');
          let data = scrape();
          if (!onUsage || !data || data.weekly == null) {
            const rpc = await replayUsageRpc();
            if (rpc) {
              if (!data) data = rpc;
              else {
                if (data.short == null && rpc.short != null) data.short = rpc.short;
                if (data.weekly == null && rpc.weekly != null) data.weekly = rpc.weekly;
                if (!data.shortReset && rpc.shortReset) data.shortReset = rpc.shortReset;
                if (!data.weeklyReset && rpc.weeklyReset) data.weeklyReset = rpc.weeklyReset;
              }
            }
          }
          sendResponse({ ok: !!data, data: data || null });
        } catch (_) {
          sendResponse({ ok: false, data: null });
        }
      })();
      return true;
    });
  } catch (_) { /* ignore */ }

  run();
  setInterval(() => { if (!stopped) run(); }, 10000);
})();
