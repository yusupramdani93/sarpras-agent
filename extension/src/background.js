/* jshint esversion: 2020 */
// Service worker: proxy POST to API so content script keeps CORS simple
// and centralizes API key handling.

const ALLOWED_TABLES = new Set([
  'tanah','bangunan','ruang','alat','alat_longitudinal',
  'bangunan_longitudinal','ruang_longitudinal','tanah_longitudinal',
  'yayasan','sekolah','akun',
]);

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return false;

  if (msg.type === 'LOG' || msg.type === 'PROGRESS' || msg.type === 'STATE') {
    // forward to popup if open; also persist state
    if (msg.type === 'STATE') {
      chrome.storage.local.set({ syncState: msg.patch ? { ...msg.patch } : {} }, () => {});
    }
    if (msg.type === 'LOG') {
      chrome.storage.local.get(['syncLog'], (r) => {
        const log = Array.isArray(r.syncLog) ? r.syncLog : [];
        log.push({ t: Date.now(), m: String(msg.msg) });
        const trimmed = log.slice(-200);
        chrome.storage.local.set({ syncLog: trimmed });
      });
    }
    if (msg.type === 'PROGRESS') {
      chrome.storage.local.set({ syncProgress: msg.value });
    }
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === 'POST_BULK') {
    (async () => {
      try {
        if (!ALLOWED_TABLES.has(msg.table)) throw new Error('Tabel tidak diizinkan: ' + msg.table);
        const cfg = (await chrome.storage.local.get(['cfg']))?.cfg || {};
        const apiBase = (cfg.apiUrl || msg.apiBase || '').replace(/\/$/, '') || 'https://sarpras.cilograng.com';
        const apiKey = cfg.apiKey || msg.apiKey || '';
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 90000);
        const r = await fetch(apiBase + '/api/agent/bulk/' + encodeURIComponent(msg.table), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
          body: JSON.stringify({ rows: msg.rows }),
          signal: ctrl.signal,
        });
        clearTimeout(timer);
        const body = await r.text();
        if (!r.ok) throw new Error('API ' + r.status + ' ' + body.trim());
        let parsed = {};
        try { parsed = JSON.parse(body); } catch (e) {}
        sendResponse({ ok: true, data: parsed });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;
  }

  if (msg.type === 'POST_ONE') {
    (async () => {
      try {
        const cfg = (await chrome.storage.local.get(['cfg']))?.cfg || {};
        const apiBase = (cfg.apiUrl || msg.apiBase || '').replace(/\/$/, '') || 'https://sarpras.cilograng.com';
        const apiKey = cfg.apiKey || msg.apiKey || '';
        const path = msg.path.startsWith('/') ? msg.path : '/' + msg.path;
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 90000);
        const r = await fetch(apiBase + path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
          body: JSON.stringify(msg.payload),
          signal: ctrl.signal,
        });
        clearTimeout(timer);
        const body = await r.text();
        if (!r.ok) throw new Error('API ' + r.status + ' ' + body.trim());
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;
  }

  if (msg.type === 'CLEAR_LOG') {
    chrome.storage.local.set({ syncLog: [], syncProgress: 0 }, () => sendResponse({ ok: true }));
    return true;
  }

  return false;
});