import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const T = require('../src/transform.js');

test('filterPayload removes _str and meta', () => {
  const out = T.filterPayload({ a: 1, b_str: 'x', key_match: 'y', nested: { c: 2, d_str: 'z' } });
  assert.deepEqual(out, { a: 1, nested: { c: 2 } });
});

test('normalizeTanahLongitudinal truncates year', () => {
  const out = T.normalizeTanahLongitudinal({ id: 'T1', tahun_ajaran_id: '20261' });
  assert.equal(out.id_tanah, 'T1');
  assert.equal(out.tahun_ajaran_id, '2026');
});

test('collectRuangParents splits', () => {
  const r = T.collectRuangParents([{ id_ruang: 'R1', parent_id_ruang: 'P1' }, { id_ruang: 'R2' }]);
  assert.equal(r.cleaned[0].parent_id_ruang, undefined);
  assert.equal(r.updates.length, 1);
  assert.equal(r.updates[0].parent_id_ruang, 'P1');
});

test('prepareRows injects sekolah_id and skips empty id', () => {
  const rows = [{ id_tanah: 'T1', nama: 'A' }, { id_tanah: '', nama: 'B' }];
  const out = T.prepareRows('tanah', rows, 'SCH1');
  assert.equal(out.length, 1);
  assert.equal(out[0].sekolah_id, 'SCH1');
});