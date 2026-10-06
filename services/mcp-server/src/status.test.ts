import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { fileURLToPath } from 'node:url';

const key = 'synthetic-contract-us';
const headers = { Authorization: `ApiKey ${key}`, 'X-Svalinn-Tenant': 'TEN_001', 'Content-Type': 'application/json' };
async function start(script: URL, env: Record<string, string>) {
  const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(script)], {
    env: { ...process.env, HOST: '127.0.0.1', PORT: '0', EVIDENCE_DB_PATH: ':memory:', ...env }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    const url = await new Promise<string>((resolve, reject) => {
      let output = '';
      const timeout = setTimeout(() => reject(new Error(`Service startup timed out: ${output}`)), 20000);
      child.once('error', error => { clearTimeout(timeout); reject(error); });
      child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Service exited ${code}: ${output}`)); });
      child.stderr!.on('data', chunk => { output += chunk.toString(); });
      child.stdout!.on('data', chunk => {
        output += chunk.toString();
        const match = output.match(/http:\/\/127\.0\.0\.1:([1-9]\d*)/);
        if (match) { clearTimeout(timeout); resolve(match[0]); }
      });
    });
    return { child, url };
  } catch (error) { child.kill(); throw error; }
}
async function connect(url: string) {
  const client = new Client({ name: 'phase-3-contract', version: '0.3.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`)));
  return client;
}

test('real Svalinn + MCP HTTP contract, upstream errors, fresh-process state and read-only behavior', async () => {
  const children: ChildProcess[] = [];
  const clients: Client[] = [];
  try {
    const insurer = await start(new URL('../../svalinn-api/src/server.ts', import.meta.url), { SVALINN_US_API_KEY: key, SVALINN_GH_API_KEY: 'synthetic-contract-gh' });
    children.push(insurer.child);
    const write = async (path: string, body: object, idempotencyKey: string) => {
      const response = await fetch(`${insurer.url}/v1${path}`, { method: 'POST', headers: { ...headers, 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(body) });
      assert.ok(response.ok);
      return (await response.json() as { data: Record<string, string> }).data;
    };
    const draft = await write('/fnols', { externalCustomerId: 'CUST_00234', claimTypeCode: 'MOTOR_GLASS', incidentAt: '2026-10-04T14:10:00Z', narrative: 'The window is cracked.' }, 'draft');
    const claim = await write(`/fnols/${draft.fnolId}/promote`, {}, 'promote');
    const env = { SVALINN_API_BASE_URL: `${insurer.url}/v1`, SVALINN_API_KEY: key, SVALINN_TENANT_ID: 'TEN_001' };
    const mcp = await start(new URL('./server.ts', import.meta.url), env);
    children.push(mcp.child);
    const client = await connect(mcp.url);
    clients.push(client);
    const listing = await client.listTools();
    assert.deepEqual(listing.tools.map(tool => tool.name), ['report_incident', 'review_evidence', 'get_claim_status', 'confirm_and_submit_claim', 'request_photo_upload']);
    const statusTool = listing.tools.find(tool => tool.name === 'get_claim_status')!;
    assert.deepEqual(statusTool.inputSchema.properties, { claim_id: { type: 'string' } });
    assert.equal(statusTool.inputSchema.additionalProperties, false);
    assert.ok(!statusTool.inputSchema.required?.includes('claim_id'));
    const call = async (name: string, args: Record<string, unknown>, key?: string) => CallToolResultSchema.parse(await client.callTool({
      name, arguments: args, ...(key ? { _meta: { 'claim-companion/idempotency-key': key } } : {}),
    }));
    const limitBefore = await fetch(`${insurer.url}/v1/claim-types`, { headers });
    const emergency = await call('report_incident', { narrative: 'Someone is injured.', anyone_injured: false, occurred_at: 'invalid', extra: 'invalid' });
    assert.equal(emergency.structuredContent?.status, 'needs_input');
    assert.equal((emergency.structuredContent?.safety as Record<string, string>).level, 'emergency');
    const safetyCheck = await call('report_incident', { narrative: 'The bumper is scratched.' });
    assert.equal((safetyCheck.structuredContent?.safety as Record<string, string>).level, 'check_needed');
    const limitAfter = await fetch(`${insurer.url}/v1/claim-types`, { headers });
    assert.equal(Number(limitBefore.headers.get('x-ratelimit-remaining')) - Number(limitAfter.headers.get('x-ratelimit-remaining')), 1);
    const initialArgs = { narrative: 'Another car backed into the parked car.', anyone_injured: false, claim_type_code: 'MOTOR_COLLISION' };
    assert.equal((await call('report_incident', initialArgs)).structuredContent?.status, 'error');
    const [report, replayReport] = await Promise.all([call('report_incident', initialArgs, 'core-create'), call('report_incident', initialArgs, 'core-create')]);
    const reportData = report.structuredContent?.data as Record<string, unknown>;
    const intakeId = reportData.intake_id as string;
    assert.equal((replayReport.structuredContent?.data as Record<string, unknown>).intake_id, intakeId);
    assert.equal(report.structuredContent?.status, 'needs_input');
    assert.deepEqual((report.structuredContent?.missing as { field: string }[]).map(item => item.field), ['occurred_at', 'location_description', 'vehicle_registration_number']);
    const rejected = await call('confirm_and_submit_claim', { intake_id: intakeId, confirmed: false });
    assert.equal(rejected.isError, true);
    const incomplete = await call('confirm_and_submit_claim', { intake_id: intakeId, confirmed: true });
    assert.equal((incomplete.structuredContent?.data as Record<string, string>).error_code, 'FNOL_INCOMPLETE');
    const corrected = await call('report_incident', { intake_id: intakeId, occurred_at: '2026-10-04T14:10:00Z', location_description: 'Oak Street', vehicle_registration_number: '7KBX294' }, 'core-complete');
    assert.equal(corrected.structuredContent?.status, 'ready_to_review');
    const ready = (corrected.structuredContent?.data as Record<string, unknown>).details as Record<string, unknown>;
    assert.equal(ready.vehicleRegistrationNumber, '7KBX294');
    assert.equal(ready.anyoneInjured, false);
    const [submitted, replaySubmit] = await Promise.all([
      call('confirm_and_submit_claim', { intake_id: intakeId, confirmed: true }), call('confirm_and_submit_claim', { intake_id: intakeId, confirmed: true }),
    ]);
    assert.equal(submitted.structuredContent?.status, 'submitted');
    assert.deepEqual(submitted.structuredContent?.data, replaySubmit.structuredContent?.data);
    const filed = submitted.structuredContent?.data as Record<string, string>;
    const lateReplay = await call('report_incident', { intake_id: intakeId, occurred_at: '2026-10-04T14:10:00Z', location_description: 'Oak Street', vehicle_registration_number: '7KBX294' }, 'core-complete');
    assert.equal(lateReplay.structuredContent?.status, 'submitted');
    assert.match(new URL(filed.upload_url).searchParams.get('token')!, /^[A-Za-z0-9_-]{43}$/);
    const upload = await call('request_photo_upload', { claim_id: filed.claim_id }, 'core-upload');
    assert.equal(upload.structuredContent?.status, 'ok');
    assert.deepEqual(upload.structuredContent?.data, (await call('request_photo_upload', { claim_id: filed.claim_id }, 'core-upload')).structuredContent?.data);
    assert.equal((await call('request_photo_upload', {})).structuredContent?.status, 'needs_input');
    assert.equal((await call('review_evidence', {})).structuredContent?.status, 'needs_input');
    const emptyEvidence = await call('review_evidence', { claim_id: filed.claim_id });
    assert.equal(emptyEvidence.structuredContent?.status, 'ok');
    assert.deepEqual((emptyEvidence.structuredContent?.data as Record<string, unknown>).evidence, []);
    const form = new FormData();
    form.set('file', new Blob(['synthetic upload transport fixture'], { type: 'image/png' }), 'fixture.png');
    form.set('kind', 'PHOTO');
    const attached = await fetch(`${insurer.url}/v1/claims/${filed.claim_id}/documents`, { method: 'POST', headers: { Authorization: headers.Authorization, 'X-Svalinn-Tenant': 'TEN_001', 'Idempotency-Key': 'core-document' }, body: form });
    assert.equal(attached.status, 201);
    const evidence = await call('review_evidence', { claim_id: filed.claim_id });
    assert.equal(((evidence.structuredContent?.data as Record<string, unknown>).evidence as unknown[]).length, 1);
    const correction = { intake_id: intakeId, location_description: 'Elm Street' };
    assert.equal((await call('report_incident', correction, 'post-file')).structuredContent?.status, 'submitted');
    await call('report_incident', correction, 'post-file');
    const correctedStatus = await call('get_claim_status', { claim_id: filed.claim_id });
    const timeline = (correctedStatus.structuredContent?.data as Record<string, unknown>).timeline as { event: string }[];
    assert.equal(timeline.filter(item => item.event === 'NOTE_ADDED').length, 1);
    const missing = CallToolResultSchema.parse(await client.callTool({ name: 'get_claim_status', arguments: {} }));
    assert.equal(missing.structuredContent?.status, 'needs_input');
    const before = CallToolResultSchema.parse(await client.callTool({ name: 'get_claim_status', arguments: { claim_id: claim.claimId } }));
    assert.equal(before.structuredContent?.status, 'ok');
    const data = before.structuredContent?.data as Record<string, unknown>;
    assert.equal(data.stage, 'SUBMITTED');
    assert.equal(data.nextMove, 'INSURER');
    assert.deepEqual(data.openTasks, []);
    assert.ok(!(before.structuredContent?.summary as string).includes(claim.claimId));
    const notFound = CallToolResultSchema.parse(await client.callTool({ name: 'get_claim_status', arguments: { claim_id: 'missing' } }));
    assert.equal(notFound.isError, true);
    assert.equal((notFound.structuredContent?.data as Record<string, string>).error_code, 'CLAIM_NOT_FOUND');
    const invalid = CallToolResultSchema.parse(await client.callTool({ name: 'get_claim_status', arguments: { claim_id: claim.claimId, extra: true } }));
    assert.equal(invalid.isError, true);
    const method = await fetch(`${mcp.url}/mcp`);
    assert.equal(method.status, 405);
    const badOrigin = await fetch(`${mcp.url}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Origin: 'https://untrusted.example' }, body: '{}' });
    assert.equal(badOrigin.status, 403);
    await client.close();
    mcp.child.kill();
    const task = { owner: 'CUSTOMER', text: 'Add one wide photo of the window.' };
    await write(`/_mock/claims/${claim.claimId}/tasks`, task, 'task');
    const fresh = await start(new URL('./server.ts', import.meta.url), env);
    children.push(fresh.child);
    const freshClient = await connect(fresh.url);
    clients.push(freshClient);
    const after = CallToolResultSchema.parse(await freshClient.callTool({ name: 'get_claim_status', arguments: { claim_id: claim.claimId } }));
    assert.equal(after.structuredContent?.status, 'ok');
    const afterData = after.structuredContent?.data as Record<string, unknown>;
    assert.equal(afterData.stage, 'INFO_REQUESTED');
    assert.equal(afterData.nextMove, 'CUSTOMER');
    assert.equal(afterData.nextStepSummary, task.text);
    assert.equal((afterData.openTasks as unknown[]).length, 1);
    assert.equal((afterData.timeline as unknown[]).length, 2); // MCP reads add no events.
    const unauthorized = await start(new URL('./server.ts', import.meta.url), { ...env, SVALINN_API_KEY: 'invalid' });
    children.push(unauthorized.child);
    const badClient = await connect(unauthorized.url);
    clients.push(badClient);
    const denied = CallToolResultSchema.parse(await badClient.callTool({ name: 'get_claim_status', arguments: { claim_id: claim.claimId } }));
    assert.equal(denied.structuredContent?.status, 'error');
    assert.equal((denied.structuredContent?.data as Record<string, string>).error_code, 'UNAUTHORIZED');
  } finally {
    await Promise.allSettled(clients.map(client => client.close()));
    children.forEach(child => child.kill());
  }
});
