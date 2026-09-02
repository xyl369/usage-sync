function fmt(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-US', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

document.getElementById('buildTag').textContent = `v${chrome.runtime.getManifest().version}`;

function render() {
  chrome.storage.local.get(['cursorSync', 'geminiSync'], (r) => {
    const c = r.cursorSync;
    const g = r.geminiSync;
    const cs = document.getElementById('cursorStatus');
    const cd = document.getElementById('cursorDetail');
    const gs = document.getElementById('geminiStatus');
    const gd = document.getElementById('geminiDetail');

    if (c && (c.auto != null || c.api != null)) {
      cs.className = 'ok';
      cs.textContent = 'Synced';
      cd.innerHTML = [
        c.auto != null ? `Cursor Models: <span class="val">${c.auto}%</span>` : null,
        c.api != null ? `Other Models: <span class="val">${c.api}%</span>` : null,
        c.reset ? `Reset: ${c.reset.replace('T', ' ')}` : null,
        `Time: ${fmt(c.syncedAt)}`,
        c.source ? `Source: ${c.source}` : null,
      ].filter(Boolean).join('<br>');
    } else {
      cs.className = 'wait';
      cs.textContent = 'Not synced yet';
      cd.textContent = 'Open and hard-refresh cursor.com/dashboard/billing (Cursor Models / Other Models must be visible)';
    }

    if (g && (g.weekly != null || g.short != null)) {
      gs.className = 'ok';
      gs.textContent = 'Synced';
      gd.innerHTML = [
        g.weekly != null ? `Weekly limit: <span class="val">${g.weekly}%</span>` : null,
        g.short != null ? `Current usage: <span class="val">${g.short}%</span>` : null,
        g.shortReset ? `Short reset: ${g.shortReset.replace('T', ' ')}` : null,
        g.weeklyReset ? `Weekly reset: ${g.weeklyReset.replace('T', ' ')}` : null,
        `Time: ${fmt(g.syncedAt)}`,
      ].filter(Boolean).join('<br>');
    } else {
      gs.className = 'wait';
      gs.textContent = 'Not synced yet';
      gd.textContent = 'Open and refresh gemini.google.com/usage';
    }
  });
}

document.getElementById('refreshBtn').addEventListener('click', render);
document.getElementById('liveBtn').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('popup/live.html') });
});
chrome.storage.onChanged.addListener(render);
render();
