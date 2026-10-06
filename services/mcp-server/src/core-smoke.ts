import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

const endpoint = process.env.MCP_SERVER_URL ?? `http://${process.env.HOST ?? '127.0.0.1'}:${process.env.PORT ?? 3002}/mcp`;
const run = randomUUID();
let sequence = 0;
async function rpc(method: string, params: object) {
  const start = performance.now();
  const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++sequence, method, params }) });
  assert.ok(response.ok, `HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(JSON.stringify(body.error));
  console.log(JSON.stringify({ method, tool: (params as { name?: string }).name, ms: Math.round(performance.now() - start) }));
  return body.result;
}
async function call(name: string, args: object, key?: string) {
  const tool = await rpc('tools/call', { name, arguments: args, ...(key ? { _meta: { 'claim-companion/idempotency-key': `${run}-${key}` } } : {}) });
  assert.ok(tool.structuredContent);
  return tool.structuredContent;
}
await rpc('initialize', { protocolVersion: '2025-11-25', clientInfo: { name: 'phase-4-raw-jsonrpc', version: '0.4.0' }, capabilities: {} });
const initialized = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25' },
  body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
assert.equal(initialized.status, 202);
const listing = await rpc('tools/list', {});
assert.equal(listing.tools.length, 5);
const safety = await call('report_incident', { narrative: 'Someone is injured.', anyone_injured: false });
assert.equal(safety.safety.level, 'emergency');
const firstArgs = { claim_type_code: 'MOTOR_COLLISION', narrative: 'Another car backed into the parked car.', anyone_injured: false };
const draft = await call('report_incident', firstArgs, 'create');
assert.equal(draft.status, 'needs_input');
const replay = await call('report_incident', firstArgs, 'create');
assert.equal(replay.data.intake_id, draft.data.intake_id);
const ready = await call('report_incident', { intake_id: draft.data.intake_id, occurred_at: '2026-10-04T14:10:00Z', date_confidence: 'exact',
  location_description: 'Oak Street parking lot', vehicle_registration_number: '7KBX294', vehicle_drivable: true }, 'complete');
assert.equal(ready.status, 'ready_to_review');
assert.equal((await call('confirm_and_submit_claim', { intake_id: draft.data.intake_id, confirmed: false })).status, 'error');
const submitted = await call('confirm_and_submit_claim', { intake_id: draft.data.intake_id, confirmed: true });
assert.equal(submitted.status, 'submitted');
assert.deepEqual((await call('confirm_and_submit_claim', { intake_id: draft.data.intake_id, confirmed: true })).data, submitted.data);
const photo = await call('request_photo_upload', { claim_id: submitted.data.claim_id }, 'photo');
assert.equal(photo.status, 'ok');
assert.deepEqual((await call('request_photo_upload', { claim_id: submitted.data.claim_id }, 'photo')).data, photo.data);
assert.equal((await call('review_evidence', { claim_id: submitted.data.claim_id })).status, 'ok');
assert.equal((await call('get_claim_status', { claim_id: submitted.data.claim_id })).status, 'ok');
console.log(JSON.stringify({ result: 'Phase 4 raw JSON-RPC smoke passed', intake_id: draft.data.intake_id, claim_id: submitted.data.claim_id,
  upload_url: photo.data.upload_url, expires_at: photo.data.expires_at, note: 'Photo portal and image processing are Phase 6; this verifies link generation only.' }, null, 2));
