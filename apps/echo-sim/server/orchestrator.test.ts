import test from 'node:test';
import assert from 'node:assert/strict';
import { Orchestrator } from './orchestrator.js';
import { DemoPlanner } from './model.js';
import { sampleReport } from '../src/types.js';

function fixture() {
  const calls: { name: string; key: string }[] = [];
  let location = 'Oak Street';
  const bridge = {
    async tools() { return ['report_incident', 'confirm_and_submit_claim'].map(name => ({ name, inputSchema: { type: 'object' as const } })); },
    async call(name: string, args: Record<string, unknown>, key: string) {
      calls.push({ name, key });
      if (name === 'confirm_and_submit_claim') return { status: 'submitted', data: { claim_id: 'CLM_TEST' } };
      if (args.location_description) location = String(args.location_description);
      return { status: 'ready_to_review', data: { intake_id: 'FNOL_TEST', details: { incidentAt: '2026-10-04T14:10:00Z', incidentLocation: { description: location }, vehicleRegistrationNumber: '7KBX294' } } };
    },
  };
  return { app: new Orchestrator(bridge, new DemoPlanner(), 'demo'), calls, change: () => { location = 'Elm Street'; } };
}
test('safety and consent precede all tools; explicit review confirmation files', async () => {
  const { app, calls } = fixture();
  const emergency = await app.turn('Someone is injured', [], 'one');
  assert.equal(emergency.stage, 'emergency'); assert.equal(calls.length, 0);
  const consent = await app.turn(sampleReport, [], 'two');
  assert.equal(consent.stage, 'consent'); assert.equal(calls.length, 0);
  const declined = await app.turn('No', [], 'three', consent.continuation);
  assert.match(declined.text, /No report/); assert.equal(calls.length, 0);
  const review = await app.turn('Yes', [{ role: 'user', text: sampleReport }], 'four', consent.continuation);
  assert.equal(review.stage, 'review'); assert.equal(calls.length, 1);
  const filed = await app.turn('Yes, file it', [], 'five', review.continuation);
  assert.equal(filed.stage, 'submitted');
  assert.deepEqual(calls.slice(1).map(call => call.name), ['report_incident', 'confirm_and_submit_claim']);
  assert.equal(calls[1].key, 'five:verify-review');
});
test('changed insurer facts require another readback and confirmation', async () => {
  const { app, calls, change } = fixture();
  const consent = await app.turn(sampleReport, [], 'one');
  const review = await app.turn('Yes', [], 'two', consent.continuation);
  change();
  const updated = await app.turn('Yes, file it', [], 'three', review.continuation);
  assert.equal(updated.stage, 'review'); assert.match(updated.text, /Elm Street/);
  assert.ok(calls.every(call => call.name !== 'confirm_and_submit_claim'));
  await assert.rejects(app.turn('Yes', [], 'four', updated.continuation + 'tampered'), /SESSION_EXPIRED/);
});
test('demo interpreter extracts only supplied facts and applies corrections', async () => {
  const planner = new DemoPlanner();
  assert.deepEqual((await planner.plan('A car hit mine', [], {})).args, { narrative: 'A car hit mine', claim_type_code: 'MOTOR_COLLISION' });
  assert.deepEqual((await planner.plan('Actually it was Elm Street, not Oak Street.', [], { intakeId: 'F' })).args, { location_description: 'Elm Street' });
});
test('model-selected submission cannot bypass the host review gate', async () => {
  let writes = 0;
  const app = new Orchestrator({
    async tools() { return [{ name: 'confirm_and_submit_claim', inputSchema: { type: 'object' as const } }]; },
    async call() { writes++; return {}; },
  }, { async plan() { return { name: 'confirm_and_submit_claim', args: { confirmed: true } }; } }, 'bedrock');
  const consent = await app.turn(sampleReport, [], 'one');
  const result = await app.turn('Yes', [], 'two', consent.continuation);
  assert.match(result.text, /review the report first/); assert.equal(writes, 0);
});
