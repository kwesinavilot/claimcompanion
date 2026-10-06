import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = process.env.SVALINN_API_BASE_URL ?? `http://${process.env.HOST ?? '127.0.0.1'}:${process.env.PORT ?? 3001}/v1`;
const key = process.env.SVALINN_US_API_KEY;
if (!key) throw new Error('Configure SVALINN_US_API_KEY.');
const runId = randomUUID();
const common = ['--silent', '--show-error', '--fail-with-body', '-H', `Authorization: ApiKey ${key}`, '-H', 'X-Svalinn-Tenant: TEN_001'];
function curl(method: string, path: string, body?: object, writeKey?: string, form?: string[]) {
  const args = [...common, '-X', method, `${base}${path}`];
  if (writeKey) args.push('-H', `Idempotency-Key: ${runId}-${writeKey}`);
  if (body !== undefined) args.push('-H', 'Content-Type: application/json', '--data-binary', '@-');
  if (form) args.push(...form);
  const response = spawnSync(process.platform === 'win32' ? 'curl.exe' : 'curl', args, { encoding: 'utf8', input: body === undefined ? undefined : JSON.stringify(body) });
  if (response.error) throw response.error;
  if (response.status !== 0) throw new Error(`${method} ${path} failed: ${response.stdout} ${response.stderr}`);
  const envelope = JSON.parse(response.stdout);
  assert.equal(envelope.status, 'ok');
  assert.ok(envelope.requestId);
  return envelope.data;
}

const draft = curl('POST', '/fnols', { externalCustomerId: 'CUST_00234', claimTypeCode: 'MOTOR_COLLISION' }, 'create');
assert.equal(draft.missingRequiredFields.length, 4);
curl('PATCH', `/fnols/${draft.fnolId}`, { vehicleRegistrationNumber: '7KBX294', incidentAt: '2026-10-04T14:10:00Z',
  incidentLocation: { description: 'Oak Street parking lot', city: 'Springfield', region: 'IL' },
  narrative: 'Another car backed into the parked car.', anyoneInjured: false, vehicleDrivable: true }, 'complete');
assert.equal(curl('GET', `/fnols/${draft.fnolId}`).incidentLocation.description, 'Oak Street parking lot');
const claim = curl('POST', `/fnols/${draft.fnolId}/promote`, {}, 'promote');
assert.deepEqual(curl('POST', `/fnols/${draft.fnolId}/promote`, {}, 'promote'), claim);
const path = `/claims/${claim.claimId}`;
// A generated 1x1 PNG is an upload transport fixture, not accident evidence.
const photo = join(tmpdir(), `svalinn-smoke-${runId}.png`);
writeFileSync(photo, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'));
try {
  const form = ['-F', `file=@${photo};type=image/png`, '-F', 'kind=PHOTO', '-F', 'label=Transport fixture'];
  const document = curl('POST', `${path}/documents`, undefined, 'document', form);
  assert.deepEqual(curl('POST', `${path}/documents`, undefined, 'document', form), document);
} finally { unlinkSync(photo); }
curl('POST', `${path}/notes`, { note: 'Customer confirmed the location.' }, 'note');
curl('PATCH', `/_mock${path}/stage`, { stage: 'ACKNOWLEDGED' }, 'stage');
const task = { owner: 'CUSTOMER', text: 'Add one wide photo of the rear bumper.' };
curl('POST', `/_mock${path}/tasks`, task, 'task');
const status = curl('GET', path);
assert.equal(status.stage, 'INFO_REQUESTED');
assert.equal(status.nextStepSummary, task.text);
assert.equal(status.nextMove, 'CUSTOMER');
assert.equal(status.evidence.length, 1);
assert.equal(status.openTasks.length, 1);
assert.equal(status.timeline.filter((entry: { event: string }) => entry.event === 'CLAIM_FILED').length, 1);
console.log(`Phase 2 live curl smoke passed: ${claim.claimId} (${claim.claimNumber}), one document, one task, no duplicate promotion/upload.`);
