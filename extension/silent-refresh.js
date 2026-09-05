/**
 * Silent usage refresh. Pattern from:
 * - Cursor: dashboard GET /api/usage-summary (ai-usagebar / CursorMeter)
 * - Gemini: batchexecute rpcid jSf9Qc (Voyager usage status)
 * Never opens a tab. Uses this Chrome profile's logged-in cookies.
 */
'use strict';

const CURSOR_SUMMARY_URLS = [
  'https://www.cursor.com/api/usage-summary',
  'https://cursor.com/api/usage-summary',
];
const GEMINI_USAGE_URL = 'https://gemini.google.com/usage';
const GEMINI_RPCID = 'jSf9Qc';
const REFRESH_MS = 22000;

function clampPct(n) {
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n * 10) / 10));
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function toLocalInput(d) {
  if (!(d instanceof Date) || isNaN(+d)) return null;
  return (
    d.getFullYear() +
    '-' + pad(d.getMonth() + 1) +
    '-' + pad(d.getDate()) +
    'T' + pad(d.getHours()) +
    ':' + pad(d.getMinutes())
  );
}

function calendarDays(a, b) {
  const start = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const end = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.max(1, Math.round((end - start) / 86400000));
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

function cookieHeader(url) {
  return new Promise((resolve) => {
    try {
      chrome.cookies.getAll({ url }, (list) => {
        const rows = list || [];
        resolve(rows.map((c) => c.name + '=' + c.value).join('; '));
      });
    } catch (_) {
      resolve('');
    }
  });
}

async function authedFetch(url, opts) {
  const headers = Object.assign({}, (opts && opts.headers) || {});
  const cookie = await cookieHeader(url);
  if (cookie && !headers.Cookie && !headers.cookie) headers.Cookie = cookie;
  return fetch(url, Object.assign({}, opts, {
    headers,
    credentials: 'include',
    cache: 'no-store',
  }));
}

function parsePercentMessage(msg) {
  const m = String(msg || '').match(/(\d+(?:\.\d+)?)\s*%/);
  return m ? clampPct(parseFloat(m[1])) : null;
}

function parseCursorSummary(json) {
  if (!json || typeof json !== 'object') return null;
  const plan = json.individualUsage && json.individualUsage.plan;
  let auto = plan ? clampPct(Number(plan.autoPercentUsed)) : null;
  let api = plan ? clampPct(Number(plan.apiPercentUsed)) : null;
  if (auto == null) auto = parsePercentMessage(json.autoModelSelectedDisplayMessage);
  if (api == null) api = parsePercentMessage(json.namedModelSelectedDisplayMessage);
  if (auto == null && api == null) return null;

  let reset = null;
  let cycleDays = null;
  if (json.billingCycleEnd) {
    const end = new Date(json.billingCycleEnd);
    reset = toLocalInput(end);
    if (json.billingCycleStart) {
      const start = new Date(json.billingCycleStart);
      if (!isNaN(+start) && !isNaN(+end)) cycleDays = calendarDays(start, end);
    }
  }
  return {
    auto,
    api,
    reset,
    cycleDays,
    source: 'api-usage-summary',
  };
}

async function fetchCursorFromApi() {
  let lastErr = 'no-response';
  for (const url of CURSOR_SUMMARY_URLS) {
    try {
      const origin = url.startsWith('https://www.') ? 'https://www.cursor.com' : 'https://cursor.com';
      const res = await authedFetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Origin: origin,
          Referer: origin + '/dashboard',
        },
      });
      if (res.status === 401 || res.status === 403) {
        lastErr = 'auth';
        continue;
      }
      if (!res.ok) {
        lastErr = 'http-' + res.status;
        continue;
      }
      const json = await res.json();
      const parsed = parseCursorSummary(json);
      if (parsed) return parsed;
      lastErr = 'schema';
    } catch (e) {
      lastErr = String(e && e.message || e);
    }
  }
  throw new Error(lastErr);
}

function matchBracket(s, start) {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') {
      inStr = true;
    } else if (ch === '[') {
      depth++;
    } else if (ch === ']') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function decodeBatchExecute(text) {
  const out = [];
  let idx = 0;
  const src = String(text || '');
  while (idx < src.length) {
    const at = src.indexOf('[["wrb.fr"', idx);
    if (at < 0) break;
    const end = matchBracket(src, at);
    if (end < 0) break;
    try {
      const rows = JSON.parse(src.slice(at, end + 1));
      if (Array.isArray(rows)) {
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          if (Array.isArray(row) && row[0] === 'wrb.fr' && typeof row[1] === 'string' && typeof row[2] === 'string') {
            try {
              out.push({ rpcid: row[1], payload: JSON.parse(row[2]) });
            } catch (_) { /* skip */ }
          }
        }
      }
    } catch (_) { /* skip */ }
    idx = end + 1;
  }
  return out;
}

function toUsagePct(raw) {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return null;
  if (raw <= 1.5) return clampPct(raw * 100);
  if (raw <= 100) return clampPct(raw);
  return null;
}

function readMetric(m) {
  if (!Array.isArray(m) || m.length < 4) return null;
  const period = m[2];
  const resetWrap = m[3];
  const percent = toUsagePct(m[1]);
  if (percent == null) return null;
  if (typeof period !== 'number') return null;
  if (!Array.isArray(resetWrap) || !Array.isArray(resetWrap[0])) return null;
  const epoch = resetWrap[0][0];
  if (typeof epoch !== 'number' || epoch < 1600000000) return null;
  return { percent, resetEpoch: epoch, period };
}

function walkMetrics(node, out) {
  if (!Array.isArray(node)) return;
  const parsed = readMetric(node);
  if (parsed) {
    out.push(parsed);
    return;
  }
  for (let i = 0; i < node.length; i++) walkMetrics(node[i], out);
}

/** 5-hour window resets sooner; weekly limit resets later. Ignore extra mid buckets. */
function pairMetrics(metrics) {
  const valid = (metrics || []).filter(Boolean);
  if (!valid.length) return null;
  const uniq = [];
  const seen = {};
  for (let i = 0; i < valid.length; i++) {
    const m = valid[i];
    const key = m.resetEpoch + ':' + m.percent;
    if (seen[key]) continue;
    seen[key] = true;
    uniq.push(m);
  }
  uniq.sort((a, b) => a.resetEpoch - b.resetEpoch);
  if (uniq.length === 1) {
    const hours = (uniq[0].resetEpoch * 1000 - Date.now()) / 3600000;
    if (hours <= 8) return { short: uniq[0], weekly: null };
    return { short: null, weekly: uniq[0] };
  }
  return { short: uniq[0], weekly: uniq[uniq.length - 1] };
}

function extractUsagePayload(payload) {
  const metrics = [];
  walkMetrics(payload, metrics);
  return pairMetrics(metrics);
}

function parseGeminiRpcBody(text) {
  const frames = decodeBatchExecute(text);
  for (let i = 0; i < frames.length; i++) {
    const usage = extractUsagePayload(frames[i].payload);
    if (usage && (usage.short || usage.weekly)) {
      return {
        short: usage.short ? usage.short.percent : null,
        weekly: usage.weekly ? usage.weekly.percent : null,
        shortReset: usage.short ? toLocalInput(new Date(usage.short.resetEpoch * 1000)) : null,
        weeklyReset: usage.weekly ? toLocalInput(new Date(usage.weekly.resetEpoch * 1000)) : null,
        source: 'rpc-' + (frames[i].rpcid || GEMINI_RPCID),
      };
    }
  }
  return null;
}

function pickWiz(html, key) {
  const re = new RegExp('"' + key + '"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"');
  const m = String(html || '').match(re);
  if (!m) return '';
  try {
    return JSON.parse('"' + m[1] + '"');
  } catch (_) {
    return m[1];
  }
}

function geminiPayloadFromScrape(data) {
  if (!data || (data.short == null && data.weekly == null)) return null;
  return {
    short: data.short,
    weekly: data.weekly,
    shortReset: data.shortReset || null,
    weeklyReset: data.weeklyReset || null,
    source: data.source || 'dom-usage',
  };
}

function geminiScore(data, tabUrl) {
  if (!data) return 0;
  let n = 0;
  if (data.short != null) n += 1;
  if (data.weekly != null) n += 3;
  if (data.short != null && data.weekly != null && data.short !== data.weekly) n += 2;
  if (data.weeklyReset) n += 1;
  if (/\/usage(?:\/|$|\?)/i.test(tabUrl || '')) n += 4;
  if (data.source && String(data.source).indexOf('dom') === 0) n += 2;
  return n;
}

function geminiComplete(data) {
  return !!(data && data.short != null && data.weekly != null);
}

async function postGeminiRpc(tokens, rpcid) {
  const at = tokens.at;
  const bl = tokens.bl || '';
  const fsid = tokens.fsid || '';
  if (!at) throw new Error('no-token');
  const id = rpcid || GEMINI_RPCID;
  const freq = JSON.stringify([[[id, '[]', null, 'generic']]]);
  const body = 'f.req=' + encodeURIComponent(freq) + '&at=' + encodeURIComponent(at) + '&';
  const reqid = 100000 + Math.floor(Math.random() * 800000);
  const url =
    'https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=' +
    encodeURIComponent(id) +
    '&source-path=' + encodeURIComponent('/usage') +
    '&bl=' + encodeURIComponent(bl) +
    '&f.sid=' + encodeURIComponent(fsid) +
    '&hl=en&_reqid=' + reqid +
    '&rt=c';
  const res = await authedFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      Origin: 'https://gemini.google.com',
      Referer: 'https://gemini.google.com/usage',
      'X-Same-Domain': '1',
    },
    body,
  });
  if (!res.ok) throw new Error('http-' + res.status);
  const text = await res.text();
  const parsed = parseGeminiRpcBody(text);
  if (!parsed) throw new Error('schema');
  return parsed;
}

async function fetchGeminiFromApi() {
  const stored = await storageGet(['geminiRpcid']);
  const rpcid = stored.geminiRpcid || GEMINI_RPCID;
  const page = await authedFetch(GEMINI_USAGE_URL, {
    method: 'GET',
    headers: {
      Accept: 'text/html',
      Origin: 'https://gemini.google.com',
      Referer: 'https://gemini.google.com/app',
    },
  });
  if (page.status === 401 || page.status === 403) throw new Error('auth');
  if (!page.ok) throw new Error('http-' + page.status);
  const html = await page.text();
  if (/accounts\.google\.com\/ServiceLogin|Sign in/i.test(html) && !pickWiz(html, 'SNlM0e')) {
    throw new Error('auth');
  }
  const tokens = {
    at: pickWiz(html, 'SNlM0e'),
    bl: pickWiz(html, 'cfb2h'),
    fsid: pickWiz(html, 'FdrFJe'),
  };
  const parsed = await postGeminiRpc(tokens, rpcid);
  if (parsed.source && parsed.source.indexOf('rpc-') === 0) {
    const found = parsed.source.slice(4);
    if (found && found !== rpcid) chrome.storage.local.set({ geminiRpcid: found });
  }
  return parsed;
}

function queryTabs(urls) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.query({ url: urls }, (tabs) => resolve(tabs || []));
    } catch (_) {
      resolve([]);
    }
  });
}

function sendTab(tabId, message) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, message, (res) => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        resolve(res || null);
      });
    } catch (_) {
      resolve(null);
    }
  });
}

async function askExistingTabs(urls, message) {
  const tabs = await queryTabs(urls);
  tabs.sort((a, b) => {
    const au = /\/usage(?:\/|$|\?)/i.test((a && a.url) || '') ? 0 : 1;
    const bu = /\/usage(?:\/|$|\?)/i.test((b && b.url) || '') ? 0 : 1;
    return au - bu;
  });
  let best = null;
  let bestScore = -1;
  for (let i = 0; i < tabs.length; i++) {
    const tab = tabs[i];
    if (!tab || tab.id == null) continue;
    const res = await sendTab(tab.id, message);
    if (!res || !res.ok || !res.data) continue;
    const score = geminiScore(res.data, tab.url);
    if (score > bestScore) {
      best = res.data;
      bestScore = score;
    }
    if (geminiComplete(res.data) && /\/usage(?:\/|$|\?)/i.test(tab.url || '')) {
      return res.data;
    }
  }
  return best;
}

function storageGet(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (r) => resolve(r || {}));
  });
}

function storageSet(obj) {
  return new Promise((resolve) => {
    chrome.storage.local.set(obj, resolve);
  });
}

function saveCursor(data) {
  const payload = {
    auto: data.auto,
    api: data.api,
    reset: data.reset || null,
    cycleDays: data.cycleDays || null,
    syncedAt: Date.now(),
    source: data.source || 'silent',
  };
  return storageSet({ cursorSync: payload }).then(() => payload);
}

function saveGemini(data) {
  const payload = {
    short: data.short,
    weekly: data.weekly,
    shortReset: data.shortReset || null,
    weeklyReset: data.weeklyReset || null,
    syncedAt: Date.now(),
    source: data.source || 'silent',
  };
  return storageSet({ geminiSync: payload }).then(() => payload);
}

async function refreshCursor() {
  try {
    return await saveCursor(await fetchCursorFromApi());
  } catch (apiErr) {
    const scraped = await askExistingTabs(
      ['https://cursor.com/*', 'https://www.cursor.com/*'],
      { type: 'SCRAPE_NOW' },
    );
    if (scraped) return saveCursor(scraped);
    throw apiErr;
  }
}

async function refreshGemini() {
  const scraped = await askExistingTabs(
    ['https://gemini.google.com/*'],
    { type: 'SCRAPE_NOW' },
  );
  const fromTab = geminiPayloadFromScrape(scraped);
  if (geminiComplete(fromTab) && String(fromTab.source || '').indexOf('dom') === 0) {
    return saveGemini(fromTab);
  }
  let fromApi = null;
  try {
    fromApi = await fetchGeminiFromApi();
  } catch (e) {
    if (fromTab) return saveGemini(fromTab);
    throw e;
  }
  if (geminiComplete(fromApi)) return saveGemini(fromApi);
  if (geminiComplete(fromTab) && geminiScore(fromTab) >= geminiScore(fromApi)) {
    return saveGemini(fromTab);
  }
  const merged = {
    short: (fromApi && fromApi.short != null) ? fromApi.short : (fromTab && fromTab.short),
    weekly: (fromApi && fromApi.weekly != null) ? fromApi.weekly : (fromTab && fromTab.weekly),
    shortReset: (fromApi && fromApi.shortReset) || (fromTab && fromTab.shortReset) || null,
    weeklyReset: (fromApi && fromApi.weeklyReset) || (fromTab && fromTab.weeklyReset) || null,
    source: (fromApi && fromApi.source) || (fromTab && fromTab.source) || 'silent',
  };
  if (merged.short == null && merged.weekly == null) throw new Error('schema');
  return saveGemini(merged);
}

function failText(err) {
  const s = String(err && err.message || err || '');
  if (s === 'auth') return 'not-signed-in';
  if (s === 'timeout') return 'timeout';
  if (s === 'schema' || s === 'no-token') return 'parse-failed';
  return s || 'failed';
}

async function refreshAll() {
  const pair = await Promise.allSettled([
    withTimeout(refreshCursor(), REFRESH_MS),
    withTimeout(refreshGemini(), REFRESH_MS),
  ]);
  const cursor = pair[0];
  const gemini = pair[1];
  const cursorOk = cursor.status === 'fulfilled';
  const geminiOk = gemini.status === 'fulfilled';
  return {
    ok: cursorOk && geminiOk,
    cursor: cursorOk
      ? { ok: true, auto: cursor.value.auto, api: cursor.value.api }
      : { ok: false, error: failText(cursor.reason) },
    gemini: geminiOk
      ? { ok: true, short: gemini.value.short, weekly: gemini.value.weekly }
      : { ok: false, error: failText(gemini.reason) },
  };
}
