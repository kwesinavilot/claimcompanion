import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from './server.js';
import { customers } from './store/seed.js';

test('Phase 1 contract: seeds, lookup shapes, auth, isolation, validation, envelopes and rate limit', async () => {
  const app = buildServer({ us: 'unit-us', gh: 'unit-gh' });
  const headers = { authorization: 'ApiKey unit-us', 'x-svalinn-tenant': 'TEN_001' };
  try {
    const types = await app.inject({ url: '/v1/claim-types', headers });
    assert.equal(types.statusCode, 200);
    assert.equal(types.json().data.length, 5);
    assert.deepEqual(types.json().data[0].requiredFields, ['incidentAt', 'incidentLocation', 'vehicleRegistrationNumber', 'narrative']);
    assert.match(types.json().requestId, /^req_/);
    assert.equal(types.headers['x-ratelimit-limit'], '2000');
    for (const record of customers) {
      const tenantHeaders = { authorization: `ApiKey ${record.tenantId === 'TEN_001' ? 'unit-us' : 'unit-gh'}`, 'x-svalinn-tenant': record.tenantId };
      for (const payload of [{ externalCustomerId: record.customer.externalCustomerId }, { phone: record.customer.phone, policyNumber: record.policies[0].policyNumber }]) {
        const result = await app.inject({ method: 'POST', url: '/v1/customers/resolve', headers: tenantHeaders, payload });
        assert.equal(result.statusCode, 200);
        assert.deepEqual(result.json().data, { customer: record.customer, policies: record.policies });
      }
    }
    const resolve = (payload: unknown) => app.inject({ method: 'POST', url: '/v1/customers/resolve', headers, payload: payload as object });
    assert.equal((await resolve({ externalCustomerId: 'CUST_01001' })).statusCode, 404);
    assert.equal((await resolve({ phone: '+14155550192', policyNumber: 'SV-AUTO-2026-10502' })).statusCode, 404);
    for (const payload of [{}, { phone: '+14155550192' }, { externalCustomerId: 'CUST_00234', extra: true }, { externalCustomerId: 'CUST_00234', phone: 'x', policyNumber: 'y' }, { externalCustomerId: 234 }]) {
      const result = await resolve(payload);
      assert.equal(result.statusCode, 400);
      assert.equal(result.json().error.code, 'VALIDATION_ERROR');
      assert.ok(result.json().requestId);
    }
    assert.equal((await app.inject({ url: '/v1/claim-types' })).statusCode, 401);
    assert.equal((await app.inject({ url: '/v1/claim-types', headers: { ...headers, 'x-svalinn-tenant': 'TEN_002' } })).statusCode, 403);
    assert.equal((await app.inject({ url: '/v1/fnols', headers })).statusCode, 404);
    const policy = customers[0].policies[0];
    policy.status = 'LAPSED';
    try { assert.equal((await resolve({ externalCustomerId: 'CUST_00234' })).statusCode, 422); }
    finally { policy.status = 'ACTIVE'; }
    let limited;
    for (let index = 0; index < 2001; index++) limited = await app.inject({ url: '/v1/claim-types', headers });
    assert.equal(limited!.statusCode, 429);
    assert.equal(limited!.headers['x-ratelimit-remaining'], '0');
  } finally { await app.close(); }
});
