import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { EvidenceStore } from './evidence-store.js';

test('upload tokens persist, are tenant scoped, idempotent, unpredictable, and expire after thirty minutes', () => {
  const path = join(tmpdir(), `claim-companion-evidence-${randomUUID()}.sqlite`);
  let now = 1000000;
  let store = new EvidenceStore(path, () => now);
  try {
    const first = store.create('TEN_001', 'clm_one', 'operation');
    assert.match(first.token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(first.expires_at - first.created_at, 30 * 60 * 1000);
    assert.equal(store.create('TEN_001', 'clm_one', 'operation').token, first.token);
    assert.throws(() => store.create('TEN_001', 'clm_other', 'operation'), /IDEMPOTENCY_KEY_CONFLICT/);
    assert.equal(store.get(first.token, 'TEN_002'), undefined);
    assert.notEqual(store.create('TEN_002', 'clm_one', 'operation').token, first.token);
    store.close();
    store = new EvidenceStore(path, () => now);
    assert.equal(store.create('TEN_001', 'clm_one', 'operation').token, first.token);
    now = first.expires_at;
    assert.equal(store.get(first.token, 'TEN_001'), undefined);
    assert.throws(() => store.create('TEN_001', 'clm_one', 'operation'), /UPLOAD_LINK_EXPIRED/);
    assert.notEqual(store.create('TEN_001', 'clm_one', 'new-operation').token, first.token);
  } finally { store.close(); unlinkSync(path); }
});
