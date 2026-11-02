/* jshint esversion: 2020 */
// Content script: runs in Dapodik origin (http://localhost:5774)

if (window.__sarprasInjected) {
  // already loaded; do nothing
} else {
  window.__sarprasInjected = true;

  const DAPODIK = 'http://localhost:5774';
  const DEFAULT_SEMESTER = '20261';

  const COLS = [
    { label: 'Tanah', endpoint: '/rest/Tanah', table: 'tanah', idField: 'id_tanah' },
    { label: 'Bangunan', endpoint: '/rest/Bangunan', table: 'bangunan', idField: 'id_bangunan' },
    { label: 'Ruang', endpoint: '/rest/Ruang', table: 'ruang', idField: 'id_ruang' },
    { label: 'Alat', endpoint: '/rest/Alat', table: 'alat', idField: 'id_alat' },
    { label: 'Alat Periodik', endpoint: '/rest/AlatLongitudinal', table: 'alat_longitudinal', idField: 'alat_longitudinal_id' },
    { label: 'Bangunan Periodik', endpoint: '/rest/BangunanLongitudinal', table: 'bangunan_longitudinal', idField: 'id_bangunan' },
    { label: 'Ruang Periodik', endpoint: '/rest/RuangLongitudinal', table: 'ruang_longitudinal', idField: 'ruang_longitudinal_id' },
    { label: 'Tanah Periodik', endpoint: '/rest/TanahLongitudinal', table: 'tanah_longitudinal', idField: 'id_tanah' },
  ];

  let running = false;
  let abortController = null;

  function log(msg) {
    try { chrome.runtime.sendMessage({ type: 'LOG', msg }); } catch (e) {}
  }
  function progress(v) {
    try { chrome.runtime.sendMessage({ type: 'PROGRESS', value: v }); } catch (e) {}
  }
  function state(patch) {
    try { chrome.runtime.sendMessage({ type: 'STATE', patch }); } catch (e) {}
  }

  async function fetchJSON(url) {
    const r = await fetch(url, { credentials: 'include' });
    if (!r.ok) throw new Error('Dapodik ' + r.status + ' ' + url);
    return r.json();
  }

  async function fetchAll(path, label) {
    const pageSize = 100;
    const all = [];
    let start = 0;
    let total = -1;
    for (let page = 1; page <= 100000; page++) {
      if (abortController.signal.aborted) throw new Error('Dibatalkan');
      const sep = path.includes('?') ? '&' : '?';
      const url = DAPODIK + path + sep + 'limit=' + pageSize + '&start=' + start;
      const data = await fetchJSON(url);
      const rows = Array.isArray(data.rows) ? data.rows : [];
      if (rows.length === 0) break;
      all.push(...rows);
      if (typeof data.results === 'number') total = data.results;
      else if (typeof data.results === 'string') { const n = Number(data.results); if (!isNaN(n)) total = n; }
      start += rows.length;
      if (total >= 0 && start >= total) break;
      if (total < 0 && rows.length < pageSize) break;
      if (page % 50 === 0) log(label + ': ' + start + '/' + (total >= 0 ? total : '?') + ' baris');
    }
    if (total >= 0 && all.length < total) log('Peringatan: ' + label + ' hanya ' + all.length + ' dari ' + total);
    return all;
  }

  function postBulk(table, rows) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'POST_BULK', table, rows }, (res) => {
        if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
        if (!res || !res.ok) { reject(new Error((res && res.error) || 'gagal kirim')); return; }
        resolve(res.data || {});
      });
    });
  }

  function postOne(path, payload) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'POST_ONE', path, payload }, (res) => {
        if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
        if (!res || !res.ok) { reject(new Error((res && res.error) || 'gagal kirim')); return; }
        resolve();
      });
    });
  }

  async function loginDapodik(cfg) {
    log('Login ke Dapodik...');
    const home = await fetch(DAPODIK + '/', { credentials: 'include' });
    const homeText = await home.text();
    const m = homeText.match(/name=['"]semester_id['"].*?option.+value=['"](\d+)['"].+selected/s);
    const sid = m && m[1] ? m[1] : DEFAULT_SEMESTER;
    const form = new URLSearchParams();
    form.set('username', cfg.username);
    form.set('password', cfg.password);
    form.set('semester_id', sid);
    form.set('rememberme', 'on');
    const r = await fetch(DAPODIK + '/roleperan', { method: 'POST', body: form, credentials: 'include' });
    const roleBody = await r.text();
    const m2 = roleBody.match(/href=["'](\/login\?[^"']+)["']/);
    if (!m2) throw new Error('role tidak ditemukan setelah login');
    await fetch(DAPODIK + m2[1], { credentials: 'include' });
    const form2 = new URLSearchParams();
    form2.set('koreg', cfg.koreg);
    const r2 = await fetch(DAPODIK + '/cekkoreg', { method: 'POST', body: form2, credentials: 'include' });
    const bb2 = await r2.text();
    if (!bb2.includes('"success":true') && !bb2.includes('"success" : true')) {
      throw new Error('kode registrasi salah: ' + bb2);
    }
    log('Login Dapodik sukses.');
  }

  async function runSync(cfg, selectedTables) {
    running = true;
    abortController = new AbortController();
    // API base/key dibaca service worker dari chrome.storage.local.cfg
    const sekolahChecked = !!cfg.syncSekolah;
    const selected = new Set(selectedTables);

    try {
      await loginDapodik(cfg);

      let sekolahId = '';
      let namaSekolah = '';
      let yayasanTotal = 0;

      if (sekolahChecked) {
        log('Mengambil data yayasan...');
        const rows = await fetchAll('/rest/Yayasan', 'Yayasan');
        const prepared = rows.map((r) => filterPayload(r));
        // send in batches
        const batch = 100;
        let sent = 0;
        for (let i = 0; i < prepared.length; i += batch) {
          if (abortController.signal.aborted) throw new Error('Dibatalkan');
          const chunk = prepared.slice(i, i + batch);
          await postBulk('yayasan', chunk);
          sent += chunk.length;
        }
        yayasanTotal = sent;
        log('Yayasan: ' + yayasanTotal + ' data');
        progress(5);

        log('Mengambil data sekolah...');
        const sekolah = await fetchJSON(DAPODIK + '/rest/sekolah');
        const rows2 = Array.isArray(sekolah.rows) ? sekolah.rows : [];
        if (rows2.length > 0 && rows2[0] && typeof rows2[0] === 'object') {
          const m = filterPayload(rows2[0]);
          sekolahId = m.sekolah_id || '';
          namaSekolah = m.nama_sekolah || m.nama || m.sekolah_nama || '';
          try { await postOne('/api/agent/sekolah', m); log('Sekolah terkirim: ' + sekolahId); }
          catch (e) { log('Peringatan kirim sekolah: ' + e.message); }
        }
        progress(10);
      }

      log('Menyimpan akun ke Server...');
      const akunData = {
        username: cfg.username,
        password: cfg.password,
        koreg: cfg.koreg,
        id_sekolah: sekolahId,
        nama_sekolah: namaSekolah,
        updatedAt: new Date().toISOString(),
      };
      try { await postOne('/api/agent/akun', akunData); log('Akun terkirim: ' + cfg.username); }
      catch (e) { log('Peringatan kirim akun: ' + e.message); }
      progress(15);

      const jobs = COLS.filter((c) => selected.has(c.table));
      if (jobs.length === 0) { progress(100); log('=== SINKRONISASI SELESAI ==='); return; }

      const step = 85 / jobs.length;
      let total = yayasanTotal;
      for (let i = 0; i < jobs.length; i++) {
        const j = jobs[i];
        if (abortController.signal.aborted) throw new Error('Dibatalkan');
        log('Mengambil ' + j.label + ' dari Dapodik...');
        const rows = await fetchAll(j.endpoint, j.label);
        log(j.label + ': ' + rows.length + ' baris diterima dari Dapodik');
        const prepared = prepareRows(j.table, rows, sekolahId);
        // ruang: two-pass parent updates
        let parentUpdates = [];
        let toSend = prepared;
        if (j.table === 'ruang') {
          const r = collectRuangParents(prepared);
          toSend = r.cleaned;
          parentUpdates = r.updates;
        }
        if (j.table === 'tanah_longitudinal') {
          // already normalized in prepareRows? ensure
        }

        const batch = 100;
        let sent = 0;
        for (let k = 0; k < toSend.length; k += batch) {
          if (abortController.signal.aborted) throw new Error('Dibatalkan');
          const chunk = toSend.slice(k, k + batch);
          await postBulk(j.table, chunk);
          sent += chunk.length;
          const done = k + chunk.length;
          if (done % 500 === 0 || done === toSend.length) {
            log(j.label + ': ' + done + '/' + toSend.length + ' diproses');
          }
          progress(15 + step * (i + (toSend.length ? done / toSend.length : 1)));
        }
        if (parentUpdates.length > 0) {
          let updated = 0;
          for (let k = 0; k < parentUpdates.length; k += batch) {
            const chunk = parentUpdates.slice(k, k + batch);
            try { await postBulk('ruang', chunk); updated += chunk.length; } catch (e) { log('Gagal kirim parent ' + e.message); }
          }
          log('ruang: ' + updated + ' relasi induk dikirim');
        }
        total += sent;
        log(j.label + ': ' + sent + ' data');
        progress(15 + step * (i + 1));
      }

      log('Total sinkronisasi: ' + total);
      progress(100);
      log('=== SINKRONISASI SELESAI ===');
    } finally {
      running = false;
      abortController = null;
      state({ running: false });
    }
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === 'START') {
      if (running) { sendResponse({ ok: false, error: 'Sudah berjalan' }); return true; }
      runSync(msg.cfg, msg.tables).then(() => {
        sendResponse({ ok: true });
      }).catch((e) => {
        log('ERROR: ' + e.message);
        sendResponse({ ok: false, error: e.message });
      });
      return true; // async
    }
    if (msg && msg.type === 'STOP') {
      if (abortController) abortController.abort();
      sendResponse({ ok: true });
      return true;
    }
    if (msg && msg.type === 'PING') {
      sendResponse({ ok: true, running });
      return true;
    }
    return false;
  });
}