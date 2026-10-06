import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { McpBridge } from '../../../apps/echo-sim/server/bridge.js';
import { defaultRequest } from './client.js';

const bridge = new McpBridge(process.env.MCP_SERVER_URL ?? 'http://127.0.0.1:3002/mcp');
const report = await bridge.call('report_incident', { claim_type_code: 'MOTOR_COLLISION', narrative: 'Another fictional car backed into mine. Nobody was hurt.', occurred_at: '2026-10-04T14:10:00Z', date_confidence: 'exact', location_description: 'Oak Street', vehicle_registration_number: '7KBX294', anyone_injured: false }, crypto.randomUUID(), []);
assert.equal(report.status, 'ready_to_review');
const intake = (report.data as { intake_id: string }).intake_id;
const filed = await bridge.call('confirm_and_submit_claim', { intake_id: intake, confirmed: true }, crypto.randomUUID(), []);
assert.equal(filed.status, 'submitted');
const claimId = (filed.data as { claim_id: string }).claim_id;
const before = await bridge.call('get_claim_status', { claim_id: claimId }, crypto.randomUUID(), []);
assert.equal((before.data as { nextMove: string }).nextMove, 'INSURER');
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:3006');
  await page.getByRole('textbox', { name: 'Claim reference' }).fill(claimId);
  await page.getByRole('button', { name: 'Open claim' }).click();
  await page.getByRole('heading', { name: 'Request more information' }).waitFor();
  // Lose the first response after Svalinn commits the task: UI retry must not create a second task.
  let interrupted = false; const keys: string[] = [];
  await page.route('**/svalinn/v1/_mock/claims/*/tasks', async route => {
    keys.push(route.request().headers()['idempotency-key']);
    if (!interrupted) { interrupted = true; await route.fetch(); await route.abort('failed'); }
    else await route.continue();
  });
  await page.getByRole('button', { name: 'Request more info', exact: false }).click();
  await page.getByRole('button', { name: 'Retry same action' }).waitFor();
  await page.getByRole('button', { name: 'Retry same action' }).click();
  await page.getByRole('status').filter({ hasText: 'Information requested' }).waitFor();
  assert.equal(keys.length, 2); assert.equal(keys[0], keys[1]);
  await page.getByLabel('Next stage').selectOption('ESTIMATE_PENDING');
  await page.getByRole('button', { name: 'Set stage', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Claim stage updated' }).waitFor();
  await mkdir('../../.local', { recursive: true });
  await page.screenshot({ path: '../../.local/adjuster-console-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: '../../.local/adjuster-console-mobile.png', fullPage: true });
  const after = await bridge.call('get_claim_status', { claim_id: claimId }, crypto.randomUUID(), []);
  const status = after.data as { nextMove: string; nextStepSummary: string; openTasks: unknown[]; stage: string };
  assert.equal(status.nextMove, 'CUSTOMER'); assert.equal(status.nextStepSummary, defaultRequest); assert.equal(status.openTasks.length, 1); assert.equal(status.stage, 'ESTIMATE_PENDING');
  const resumed = await new Promise<{ text: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/resume-probe.ts'], { cwd: process.cwd(), env: { ...process.env, DEMO_CLAIM_ID: claimId }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; let diagnostics = '';
    child.stdout.on('data', chunk => { output += chunk.toString(); }); child.stderr.on('data', chunk => { diagnostics += chunk.toString(); });
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Fresh-process check timed out')); }, 20000);
    child.on('error', error => { clearTimeout(timeout); reject(error); });
    child.on('exit', code => { clearTimeout(timeout); const line = output.split(/\r?\n/).find(line => line.startsWith('RESUME_RESULT=')); if (code !== 0 || !line) reject(new Error(`Fresh-process check failed: ${diagnostics.slice(0, 200)}`)); else resolve(JSON.parse(line.slice('RESUME_RESULT='.length))); });
  });
  assert.equal(resumed.text, defaultRequest);
  const voice = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  voice.on('pageerror', error => errors.push(error.message));
  await voice.addInitScript('Object.defineProperty(window, "speechSynthesis", {value: {cancel(){}, speak(){}}});');
  await voice.goto('http://127.0.0.1:5173');
  await voice.getByLabel('Continue an existing claim').fill(claimId);
  await voice.getByRole('button', { name: 'Open existing claim' }).scrollIntoViewIfNeeded();
  await voice.getByRole('button', { name: 'Open existing claim' }).click();
  await voice.getByText('A new conversation, with your existing claim. Ask me how it is going.', { exact: true }).waitFor();
  await voice.getByRole('textbox', { name: 'Your message' }).fill('How is my claim going?');
  await voice.getByRole('button', { name: 'Send message', exact: true }).click();
  await voice.getByRole('log').getByText(defaultRequest, { exact: true }).waitFor();
  await voice.screenshot({ path: '../../.local/remembered-voice.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ claimId, before: 'INSURER', after: status.nextMove, nextStep: resumed.text, taskCount: status.openTasks.length, passed: ['adjuster UI task', 'lost-response retry idempotency', 'stage change', 'mobile layout', 'fresh MCP/orchestrator process', 'empty-history voice conversation', 'no browser errors'] }, null, 2));
} finally { await browser.close(); }
