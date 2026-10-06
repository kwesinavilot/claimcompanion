import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from './server.js';

test('upload validation rejects unsupported, empty, missing-kind and oversized files without attaching evidence', async () => {
  const app = buildServer({ us: 'test-us', gh: 'test-gh' });
  const headers = { authorization: 'ApiKey test-us', 'x-svalinn-tenant': 'TEN_001', 'idempotency-key': 'upload-validation' };
  try {
    const fnol = await app.inject({ method: 'POST', url: '/v1/fnols', headers, payload: {
      externalCustomerId: 'CUST_00234', claimTypeCode: 'MOTOR_GLASS', incidentAt: '2026-10-04T14:10:00Z', narrative: 'The window is cracked.',
    } });
    const promoted = await app.inject({ method: 'POST', url: `/v1/fnols/${fnol.json().data.fnolId}/promote`, headers, payload: {} });
    const claimUrl = `/v1/claims/${promoted.json().data.claimId}`;
    for (const example of [
      { mime: 'text/plain', bytes: 'hello', kind: 'PHOTO', expected: 400 },
      { mime: 'image/png', bytes: '', kind: 'PHOTO', expected: 400 },
      { mime: 'image/png', bytes: 'fixture', kind: '', expected: 400 },
      { mime: 'image/png', bytes: 'x'.repeat(10 * 1024 * 1024 + 1), kind: 'PHOTO', expected: 413 },
    ]) {
      const payload = `--boundary\r\nContent-Disposition: form-data; name="kind"\r\n\r\n${example.kind}\r\n--boundary\r\nContent-Disposition: form-data; name="file"; filename="fixture"\r\nContent-Type: ${example.mime}\r\n\r\n${example.bytes}\r\n--boundary--\r\n`;
      const result = await app.inject({ method: 'POST', url: `${claimUrl}/documents`, headers: { ...headers, 'content-type': 'multipart/form-data; boundary=boundary' }, payload });
      assert.equal(result.statusCode, example.expected);
      assert.equal(result.json().status, 'error');
      assert.ok(result.json().requestId);
      const claim = await app.inject({ url: claimUrl, headers });
      assert.equal(claim.json().data.evidence.length, 0);
      assert.equal(claim.json().data.timeline.length, 1);
    }
  } finally { await app.close(); }
});
