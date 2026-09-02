function line(r) {
  const c = r.cursorSync;
  const g = r.geminiSync;
  const parts = [];
  if (c) parts.push('Cursor Models ' + c.auto + '% · Other Models ' + c.api + '%');
  else parts.push('Cursor 还没有');
  if (g) parts.push('Gemini 当前 ' + g.short + '% · 每周 ' + g.weekly + '%');
  else parts.push('Gemini 还没有');
  return parts.join('\n');
}

function draw() {
  chrome.storage.local.get(['cursorSync', 'geminiSync'], (r) => {
    const el = document.getElementById('status');
    const ok = r.cursorSync && r.geminiSync;
    el.className = ok ? 'ok' : 'wait';
    el.textContent = line(r);
    document.getElementById('out').textContent = JSON.stringify(r, null, 2);
  });
}

chrome.storage.onChanged.addListener(draw);
draw();
