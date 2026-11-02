/* jshint esversion: 2020 */
const COLS = [
  { label: 'Tanah', table: 'tanah' },
  { label: 'Bangunan', table: 'bangunan' },
  { label: 'Ruang', table: 'ruang' },
  { label: 'Alat', table: 'alat' },
  { label: 'Alat Periodik', table: 'alat_longitudinal' },
  { label: 'Bangunan Periodik', table: 'bangunan_longitudinal' },
  { label: 'Ruang Periodik', table: 'ruang_longitudinal' },
  { label: 'Tanah Periodik', table: 'tanah_longitudinal' },
];

const $ = (id) => document.getElementById(id);

async function loadConfig() {
  const r = await chrome.storage.local.get(['cfg']);
  const cfg = r.cfg || {};
  $('username').value = cfg.username || '';
  $('password').value = '';
  // password from session if not remembered
  const sess = await chrome.storage.session.get(['password']);
  if (sess.password) $('password').value = sess.password;
  if (cfg.remember) {
    const loc = await chrome.storage.local.get(['password']);
    if (loc.password) $('password').value = loc.password;
  }
  $('koreg').value = cfg.koreg || '';
  $('apiKey').value = cfg.apiKey || '01049ca3f8d76ca64c0350f2185e5b5476c4041b7997dc6605cfa1a0fdd04a1d';
  $('apiUrl').value = cfg.apiUrl || 'https://sarpras.cilograng.com';
  $('remember').checked = !!cfg.remember;
  $('syncSekolah').checked = cfg.syncSekolah !== false;
  const sel = new Set(cfg.tables || COLS.map(c => c.table));
  document.querySelectorAll('.col-cb').forEach(cb => { cb.checked = sel.has(cb.dataset.table); });
}

function saveConfig() {
  const cfg = {
    username: $('username').value.trim(),
    koreg: $('koreg').value.trim(),
    apiKey: $('apiKey').value.trim(),
    apiUrl: $('apiUrl').value.trim(),
    remember: $('remember').checked,
    syncSekolah: $('syncSekolah').checked,
    tables: Array.from(document.querySelectorAll('.col-cb:checked')).map(cb => cb.dataset.table),
  };
  return new Promise((resolve) => {
    chrome.storage.local.set({ cfg }, () => {
      if (cfg.remember) chrome.storage.local.set({ password: $('password').value });
      else { chrome.storage.local.remove(['password']); chrome.storage.session.set({ password: $('password').value }); }
      resolve(cfg);
    });
  });
}

function renderCols() {
  const box = $('cols');
  box.innerHTML = '';
  for (const c of COLS) {
    const lbl = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'col-cb';
    cb.dataset.table = c.table;
    cb.checked = true;
    lbl.appendChild(cb);
    lbl.appendChild(document.createTextNode(' ' + c.label));
    box.appendChild(lbl);
  }
}

async function findDapodikTab() {
  const tabs = await chrome.tabs.query({ url: 'http://localhost:5774/*' });
  return tabs && tabs.length ? tabs[0] : null;
}

async function ensureContentScript(tabId) {
  try {
    const r = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    if (r && r.ok) return true;
  } catch (e) {}
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['src/transform.js', 'src/content.js'] });
    await new Promise(res => setTimeout(res, 300));
    const r2 = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    return !!(r2 && r2.ok);
  } catch (e) { return false; }
}

async function refreshHint() {
  const tab = await findDapodikTab();
  const hint = $('dapodikHint');
  if (tab) hint.textContent = 'Dapodik terdeteksi di tab: ' + (tab.title || tab.url);
  else hint.textContent = 'Dapodik belum dibuka. Buka http://localhost:5774 lalu login.';
}

function setRunning(running) {
  $('start').disabled = running;
  $('stop').disabled = !running;
}

async function startSync() {
  const cfg = await saveConfig();
  cfg.username = $('username').value.trim();
  cfg.password = $('password').value;
  // store password in cfg passed to content script (memory only message)
  const tables = Array.from(document.querySelectorAll('.col-cb:checked')).map(cb => cb.dataset.table);
  cfg.tables = tables;
  cfg.syncSekolah = $('syncSekolah').checked;

  const tab = await findDapodikTab();
  if (!tab) {
    $('status').textContent = 'Buka Dapodik dulu';
    await chrome.tabs.create({ url: 'http://localhost:5774' });
    return;
  }
  const ok = await ensureContentScript(tab.id);
  if (!ok) {
    $('status').textContent = 'Gagal inject content script. Refresh tab Dapodik.';
    return;
  }
  // persist cfg to storage so background can read apiBase/key
  await chrome.storage.local.set({ cfg });
  if (cfg.remember) await chrome.storage.local.set({ password: cfg.password });
  else { await chrome.storage.local.remove(['password']); await chrome.storage.session.set({ password: cfg.password }); }

  $('status').textContent = 'Sedang sinkronisasi...';
  setRunning(true);
  chrome.tabs.sendMessage(tab.id, { type: 'START', cfg, tables }, (res) => {
    if (chrome.runtime.lastError) {
      $('status').textContent = 'Error: ' + chrome.runtime.lastError.message;
      setRunning(false);
      return;
    }
    if (res && !res.ok) {
      $('status').textContent = 'Gagal: ' + (res.error || 'unknown');
      setRunning(false);
    } else {
      $('status').textContent = 'Selesai';
      setRunning(false);
    }
  });
}

function stopSync() {
  findDapodikTab().then(tab => {
    if (tab) chrome.tabs.sendMessage(tab.id, { type: 'STOP' });
  });
}

function renderLog() {
  chrome.storage.local.get(['syncLog', 'syncProgress'], (r) => {
    const log = Array.isArray(r.syncLog) ? r.syncLog : [];
    $('log').textContent = log.map(e => new Date(e.t).toLocaleTimeString() + ' ' + e.m).join('\n');
    const p = typeof r.syncProgress === 'number' ? r.syncProgress : 0;
    $('bar').style.width = Math.min(100, Math.max(0, p)) + '%';
    const logEl = $('log');
    logEl.scrollTop = logEl.scrollHeight;
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  renderCols();
  await loadConfig();
  await refreshHint();
  renderLog();
  const poll = setInterval(renderLog, 1000);
  window.addEventListener('unload', () => clearInterval(poll));

  $('start').addEventListener('click', startSync);
  $('stop').addEventListener('click', stopSync);
  $('clear').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'CLEAR_LOG' }, () => renderLog());
  });
});