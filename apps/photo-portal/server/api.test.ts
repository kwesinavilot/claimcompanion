import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { buildServer } from '../../../services/svalinn-api/src/server.js';
import { EvidenceStore } from '../../../services/mcp-server/src/evidence-store.js';
import { EvidenceWorker } from '../../../services/evidence-pipeline/src/worker.js';
import { UnavailableAnalysis } from '../../../services/evidence-pipeline/src/analysis.js';
import { detailedPhoto } from '../../../services/evidence-pipeline/src/fixture.js';
import { buildApi } from './api.js';

test('durable batch consumption, quality gate, raw forwarding, retries and expiry', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'claim-photos-'));
  const insurer = buildServer({ us: 'test-us-photo-key', gh: 'test-gh-photo-key' });
  await insurer.listen({ host: '127.0.0.1', port: 0 });
  const address = insurer.server.address(); assert.ok(address && typeof address === 'object');
  const config = { baseUrl: `http://127.0.0.1:${address.port}/v1`, apiKey: 'test-us-photo-key', tenantId: 'TEN_001' };
  const headers = { Authorization: `ApiKey ${config.apiKey}`, 'X-Svalinn-Tenant': config.tenantId, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() };
  const create = await fetch(`${config.baseUrl}/fnols`, { method: 'POST', headers, body: JSON.stringify({ externalCustomerId: 'CUST_00234', claimTypeCode: 'MOTOR_COLLISION', narrative: 'A fictional car backed into mine.', incidentAt: '2026-10-04T14:10:00Z', dateConfidence: 'exact', incidentLocation: { description: 'Oak Street' }, vehicleRegistrationNumber: '7KBX294', anyoneInjured: false }) });
  const draft = await create.json() as { data: { fnolId: string } };
  const promoted = await fetch(`${config.baseUrl}/fnols/${draft.data.fnolId}/promote`, { method: 'POST', headers: { ...headers, 'Idempotency-Key': randomUUID() }, body: '{}' });
  const claimId = (await promoted.json() as { data: { claimId: string } }).data.claimId;
  let now = Date.now();
  let store = new EvidenceStore(join(directory, 'evidence.sqlite'), () => now);
  let api = buildApi(store, config); await api.ready();
  const session = store.create(config.tenantId, claimId, 'first');
  const good = await detailedPhoto();
  const dark = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#000000' } }).png().toBuffer();
  const key = randomUUID();
  async function upload(bytes = good, label = 'Damage close-up', operation = key) {
    const form = new FormData(); form.append('photos', new Blob([new Uint8Array(bytes)], { type: 'image/png' }), 'fictional.png'); form.set('labels', JSON.stringify([label]));
    const encoded = new Request('http://local/', { method: 'POST', body: form });
    return api.inject({ method: 'POST', url: '/api/photos', headers: { authorization: `Bearer ${session.token}`, 'idempotency-key': operation, 'content-type': encoded.headers.get('content-type')! }, payload: Buffer.from(await encoded.arrayBuffer()) });
  }
  try {
    assert.equal((await upload(Buffer.from('not a photo'))).statusCode, 400);
    assert.ok(store.get(session.token, config.tenantId));
    assert.equal((await upload()).statusCode, 202);
    assert.equal(store.get(session.token, config.tenantId), undefined);
    assert.equal((await upload()).statusCode, 202);
    assert.equal((await upload(good, 'Scene wide')).statusCode, 409);
    assert.equal(store.jobs(session.token, config.tenantId).length, 1);
    await api.close(); store.close();
    store = new EvidenceStore(join(directory, 'evidence.sqlite'), () => now);
    api = buildApi(store, config); await api.ready();
    const worker = new EvidenceWorker(store, config, new UnavailableAnalysis());
    const pending = store.pending(config.tenantId)[0];
    await worker.run(pending); await worker.run(pending); // Simulate a replay after a worker crash before recording success.
    let response = await fetch(`${config.baseUrl}/claims/${claimId}`, { headers });
    let claim = await response.json() as { data: { evidence: unknown[] } };
    assert.equal(claim.data.evidence.length, 1);
    assert.equal(store.jobs(session.token, config.tenantId)[0].status, 'done');
    assert.deepEqual(store.jobs(session.token, config.tenantId)[0].ocr_result, { status: 'unavailable', needs_human_review: true });
    const other = store.create(config.tenantId, claimId, 'retake');
    store.acceptBatch(other.token, config.tenantId, randomUUID(), 'dark', [{ bytes: dark, filename: 'dark.png', mime_type: 'image/png', label: 'Scene wide' }]);
    await worker.run(store.pending(config.tenantId)[0]);
    assert.equal(store.jobs(other.token, config.tenantId)[0].error, 'RETAKE_NEEDED');
    response = await fetch(`${config.baseUrl}/claims/${claimId}`, { headers });
    claim = await response.json() as typeof claim; assert.equal(claim.data.evidence.length, 1);
    assert.equal(store.session(session.token, 'TEN_002'), undefined);
    assert.equal((await api.inject({ url: '/api/session', headers: { authorization: `Bearer ${session.token}`, origin: 'http://untrusted.example' } })).statusCode, 403);
    now = session.expires_at;
    assert.equal((await api.inject({ url: '/api/session', headers: { authorization: `Bearer ${session.token}` } })).statusCode, 410);
    store.pruneJobs(); assert.equal(store.jobs(session.token, config.tenantId).length, 0);
  } finally { await api.close(); store.close(); await insurer.close(); await rm(directory, { recursive: true, force: true }); }
});
