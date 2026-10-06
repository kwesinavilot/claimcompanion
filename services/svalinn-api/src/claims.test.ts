import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from './server.js';

const headers = { authorization: 'ApiKey test-us', 'x-svalinn-tenant': 'TEN_001' };
const ghHeaders = { authorization: 'ApiKey test-gh', 'x-svalinn-tenant': 'TEN_002' };
const complete = { externalCustomerId: 'CUST_00234', claimTypeCode: 'MOTOR_COLLISION', vehicleRegistrationNumber: '7KBX294',
  incidentAt: '2026-10-04T14:10:00Z', incidentLocation: { description: 'Oak Street', city: 'Springfield', region: 'IL' },
  narrative: 'Another car backed into the parked car.', anyoneInjured: false, vehicleDrivable: true };

test('draft lifecycle, missing fields, validation, tenant isolation and promotion idempotency', async () => {
  const app = buildServer({ us: 'test-us', gh: 'test-gh' });
  const send = (method: 'POST' | 'PATCH' | 'GET', url: string, payload?: object, key = 'key', auth = headers) => app.inject({ method, url, headers: { ...auth, 'idempotency-key': key }, ...(payload ? { payload } : {}) });
  try {
    assert.equal((await send('POST', '/v1/fnols', complete, '')).statusCode, 400);
    const input = { externalCustomerId: 'CUST_00234', claimTypeCode: 'MOTOR_COLLISION' };
    const created = await send('POST', '/v1/fnols', input);
    assert.equal(created.statusCode, 201);
    const draft = created.json().data;
    assert.deepEqual(draft.missingRequiredFields, ['incidentAt', 'incidentLocation', 'vehicleRegistrationNumber', 'narrative']);
    const url = `/v1/fnols/${draft.fnolId}`;
    const replay = await send('POST', '/v1/fnols', { claimTypeCode: 'MOTOR_COLLISION', externalCustomerId: 'CUST_00234' });
    assert.deepEqual(replay.json().data, draft);
    assert.notEqual(replay.json().requestId, created.json().requestId);
    assert.equal((await send('POST', '/v1/fnols', complete)).statusCode, 409);
    const incomplete = await send('POST', `${url}/promote`, {});
    assert.equal(incomplete.statusCode, 422);
    assert.deepEqual(incomplete.json().error.missingRequiredFields, draft.missingRequiredFields);
    assert.equal((await send('GET', url, undefined, 'x', ghHeaders)).statusCode, 404);
    assert.equal((await send('PATCH', url, complete)).statusCode, 200);
    assert.equal((await send('PATCH', url, { incidentLocation: { description: 'Elm Street' } }, 'correction')).statusCode, 200);
    const corrected = (await send('GET', url)).json().data;
    assert.equal(corrected.incidentLocation.description, 'Elm Street');
    assert.equal(corrected.incidentLocation.city, 'Springfield');
    assert.equal(corrected.anyoneInjured, false);
    assert.equal((await send('PATCH', url, complete)).statusCode, 200);
    assert.equal((await send('GET', url)).json().data.incidentLocation.description, 'Elm Street');
    const promoted = await send('POST', `${url}/promote`, {});
    assert.equal(promoted.statusCode, 201);
    const claim = promoted.json().data;
    assert.deepEqual((await send('POST', `${url}/promote`, {})).json().data, claim);
    assert.equal((await send('POST', `${url}/promote`, {}, 'different-key')).json().data.claimId, claim.claimId);
    assert.equal((await send('PATCH', url, { narrative: 'A correction' }, 'new')).statusCode, 422);
    assert.equal((await send('GET', `/v1/claims/${claim.claimId}`, undefined, 'x', ghHeaders)).statusCode, 404);
    const status = (await send('GET', `/v1/claims/${claim.claimId}`)).json().data;
    assert.equal(status.nextMove, 'INSURER');
    assert.equal(status.timeline.length, 1);
    assert.equal((await send('GET', url)).json().data.claimId, claim.claimId);
    for (const payload of [{ ...complete, claimTypeCode: 'UNKNOWN' }, { ...complete, incidentAt: 'yesterday' }, { ...complete, unknown: true }]) {
      assert.equal((await send('POST', '/v1/fnols', payload, 'invalid')).statusCode, 400);
    }
    assert.equal((await send('POST', '/v1/fnols', { ...complete, policyNumber: 'SV-AUTO-2026-10502' }, 'mismatch')).statusCode, 404);
    assert.equal((await send('POST', '/v1/fnols', { ...complete, vehicleRegistrationNumber: '4LMN812' }, 'vehicle')).statusCode, 422);
    const gh = await send('POST', '/v1/fnols', { policyNumber: 'SV-GH-AUTO-2026-2201', claimTypeCode: 'MOTOR_GLASS' }, 'key', ghHeaders);
    assert.equal(gh.statusCode, 201);
    assert.deepEqual(gh.json().data.missingRequiredFields, ['incidentAt', 'narrative']);
    for (const code of ['MOTOR_THEFT', 'MOTOR_HIT_AND_RUN', 'MOTOR_WEATHER']) {
      const result = await send('POST', '/v1/fnols', { policyNumber: 'SV-AUTO-2026-10481', claimTypeCode: code }, code);
      assert.deepEqual(result.json().data.missingRequiredFields, ['incidentAt', 'incidentLocation', code === 'MOTOR_THEFT' ? 'policeReportNumber' : 'narrative']);
    }
  } finally { await app.close(); }
});

test('uploads, notes and mock actions are idempotent and drive subsequent claim reads', async () => {
  const app = buildServer({ us: 'test-us', gh: 'test-gh' });
  const send = (method: 'POST' | 'PATCH' | 'GET', url: string, payload?: object, key = 'key') => app.inject({ method, url, headers: { ...headers, 'idempotency-key': key }, ...(payload ? { payload } : {}) });
  try {
    const fnolId = (await send('POST', '/v1/fnols', complete)).json().data.fnolId;
    const claimId = (await send('POST', `/v1/fnols/${fnolId}/promote`, {})).json().data.claimId;
    const claimUrl = `/v1/claims/${claimId}`;
    const upload = (label: string, content = 'synthetic image fixture', reverse = false, auth = headers) => {
      const boundary = `test-${Math.random()}`;
      const fields = [`Content-Disposition: form-data; name="kind"\r\n\r\nPHOTO`, `Content-Disposition: form-data; name="label"\r\n\r\n${label}`];
      if (reverse) fields.reverse();
      fields.push(`Content-Disposition: form-data; name="file"; filename="demo.png"\r\nContent-Type: image/png\r\n\r\n${content}`);
      return app.inject({ method: 'POST', url: `${claimUrl}/documents`, headers: { ...auth, 'idempotency-key': 'upload', 'content-type': `multipart/form-data; boundary=${boundary}` },
        payload: fields.map(field => `--${boundary}\r\n${field}\r\n`).join('') + `--${boundary}--\r\n` });
    };
    const document = await upload('Rear bumper');
    assert.equal(document.statusCode, 201);
    assert.deepEqual((await upload('Rear bumper', undefined, true)).json().data, document.json().data);
    assert.equal((await upload('Other label')).statusCode, 409);
    assert.equal((await upload('Rear bumper', 'different content')).statusCode, 409);
    assert.equal((await upload('Rear bumper', undefined, false, ghHeaders)).statusCode, 404);
    const note = { note: 'Customer corrected the location to Elm Street.' };
    const noteResult = await send('POST', `${claimUrl}/notes`, note);
    assert.equal(noteResult.statusCode, 200);
    assert.deepEqual((await send('POST', `${claimUrl}/notes`, note)).json().data, noteResult.json().data);
    assert.equal((await send('POST', `${claimUrl}/notes`, { note: 'Different note' })).statusCode, 409);
    const taskUrl = `/v1/_mock/claims/${claimId}/tasks`;
    const task = { owner: 'CUSTOMER', text: 'Add a wide photo of the rear bumper.' };
    const taskResult = await send('POST', taskUrl, task);
    assert.equal(taskResult.statusCode, 201);
    assert.deepEqual((await send('POST', taskUrl, task)).json().data, taskResult.json().data);
    await send('POST', taskUrl, { owner: 'REPAIRER', text: 'Arrange an estimate.' }, 'second-task');
    let status = (await send('GET', claimUrl)).json().data;
    assert.equal(status.stage, 'INFO_REQUESTED');
    assert.equal(status.nextMove, 'CUSTOMER');
    assert.equal(status.nextStepSummary, task.text);
    assert.equal(status.evidence.length, 1);
    assert.equal(status.openTasks.length, 2);
    assert.equal(status.timeline.filter((entry: { event: string }) => entry.event === 'NOTE_ADDED').length, 1);
    const stageUrl = `/v1/_mock/claims/${claimId}/stage`;
    const stageResult = await send('PATCH', stageUrl, { stage: 'ESTIMATE_PENDING' });
    assert.equal(stageResult.statusCode, 200);
    assert.deepEqual((await send('PATCH', stageUrl, { stage: 'ESTIMATE_PENDING' })).json().data, stageResult.json().data);
    assert.equal((await send('PATCH', stageUrl, { stage: 'IN_REPAIR' })).statusCode, 409);
    assert.equal((await send('PATCH', stageUrl, { stage: 'BAD' }, 'invalid')).statusCode, 400);
    status = (await send('GET', claimUrl)).json().data;
    assert.equal(status.stage, 'ESTIMATE_PENDING');
    assert.equal(status.nextStepSummary, task.text);
    assert.equal(status.timeline.filter((entry: { event: string }) => entry.event === 'STAGE_CHANGED_ESTIMATE_PENDING').length, 1);
    assert.equal((await app.inject({ method: 'POST', url: taskUrl, payload: task })).statusCode, 401);
    assert.equal((await send('POST', `${claimUrl}/documents`, {})).statusCode, 400);
    assert.equal((await send('POST', `${claimUrl}/notes`, { note: '  ' }, 'empty')).statusCode, 400);
  } finally { await app.close(); }
});
