/* jshint esversion: 2020 */
// Port of filterPayload + transform logic from agent/main.go

function filterPayload(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return p;
  const out = {};
  for (const k of Object.keys(p)) {
    const v = p[k];
    if (k.endsWith('_str')) continue;
    if (k === 'key_match' || k === 'header') continue;
    if (k === 'bentuk_pendidikan_id_str' || k === 'kode_wilayah_str' || k === 'kebutuhan_khusus_id_str' ||
        k === 'id_ruang_str' || k === 'jenis_sarana_id_str' || k === 'jenis_prasarana_id_str' ||
        k === 'sekolah_id_str' || k === 'id_bangunan_str' || k === 'id_tanah_str') continue;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = filterPayload(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function normalizeTanahLongitudinal(row) {
  const m = { ...row };
  let tahunAjaran = '';
  const v = m.tahun_ajaran_id;
  if (typeof v === 'string') tahunAjaran = v;
  else if (typeof v === 'number') tahunAjaran = String(Math.trunc(v));
  if (tahunAjaran.length > 4) tahunAjaran = tahunAjaran.slice(0, 4);
  if (!tahunAjaran) tahunAjaran = String(Math.random()).slice(2, 6) || '0';
  m.id_tanah = m.id_tanah || m.id;
  m.tahun_ajaran_id = tahunAjaran;
  return m;
}

function collectRuangParents(rows) {
  const updates = [];
  const cleaned = rows.map((row) => {
    const m = { ...row };
    if (typeof m.parent_id_ruang === 'string' && m.parent_id_ruang !== '') {
      updates.push({ id_ruang: m.id_ruang || m.id, parent_id_ruang: m.parent_id_ruang });
    }
    delete m.parent_id_ruang;
    return m;
  });
  return { cleaned, updates };
}

function injectSekolahId(row, sekolahId) {
  if (sekolahId && typeof row === 'object' && row !== null) {
    row.sekolah_id = sekolahId;
  }
  return row;
}

function prepareRows(table, rows, sekolahId) {
  const out = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const m = filterPayload(row);
    const idField = ID_FIELDS[table];
    const id = idField ? m[idField] : null;
    if (idField && (id === undefined || id === null || id === '')) continue;
    if (table !== 'yayasan') injectSekolahId(m, sekolahId);
    if (table === 'tanah_longitudinal') out.push(normalizeTanahLongitudinal(m));
    else out.push(m);
  }
  return out;
}

const ID_FIELDS = {
  tanah: 'id_tanah',
  bangunan: 'id_bangunan',
  ruang: 'id_ruang',
  alat: 'id_alat',
  alat_longitudinal: 'alat_longitudinal_id',
  bangunan_longitudinal: 'id_bangunan',
  ruang_longitudinal: 'ruang_longitudinal_id',
  tanah_longitudinal: 'id_tanah',
  yayasan: 'yayasan_id',
};

const TABLE_ORDER = [
  'yayasan', 'tanah', 'bangunan', 'ruang', 'alat',
  'alat_longitudinal', 'bangunan_longitudinal', 'ruang_longitudinal', 'tanah_longitudinal',
];

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    filterPayload, normalizeTanahLongitudinal, collectRuangParents,
    injectSekolahId, prepareRows, ID_FIELDS, TABLE_ORDER,
  };
}