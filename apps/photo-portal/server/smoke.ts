import { chromium } from 'playwright';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import sharp from 'sharp';
import assert from 'node:assert/strict';
import { McpBridge } from '../../echo-sim/server/bridge.js';
import { detailedPhoto } from '../../../services/evidence-pipeline/src/fixture.js';

const bridge = new McpBridge(process.env.MCP_SERVER_URL ?? 'http://127.0.0.1:3002/mcp');
const report = await bridge.call('report_incident', { claim_type_code: 'MOTOR_COLLISION', narrative: 'Another fictional car backed into my parked car. Nobody was hurt.', occurred_at: '2026-10-04T14:10:00Z', date_confidence: 'exact', location_description: 'Oak Street', vehicle_registration_number: '7KBX294', anyone_injured: false }, randomUUID(), []);
assert.equal(report.status, 'ready_to_review');
const intake = (report.data as { intake_id: string }).intake_id;
const filed = await bridge.call('confirm_and_submit_claim', { intake_id: intake, confirmed: true }, randomUUID(), []);
assert.equal(filed.status, 'submitted');
const data = filed.data as { claim_id: string; upload_url: string };
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(data.upload_url);
  await page.getByRole('heading', { name: 'Your photos', exact: true }).waitFor();
  assert.ok(!page.url().includes('token='), 'Capability token should be removed from browser URL');
  await page.locator('.choose input').setInputFiles([
    { name: 'fictional-detail.png', mimeType: 'image/png', buffer: await detailedPhoto() },
    { name: 'fictional-dark.png', mimeType: 'image/png', buffer: await sharp({ create: { width: 640, height: 480, channels: 3, background: '#000000' } }).png().toBuffer() },
  ]);
  await page.locator('select').first().selectOption('Scene wide');
  assert.equal(await page.locator('.previews img').first().evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0), true);
  await page.getByRole('button', { name: 'Send 2 photos' }).click();
  await page.getByText('Received by Svalinn', { exact: true }).waitFor({ timeout: 30000 });
  await page.getByText('Please retake this photo', { exact: true }).waitFor();
  await page.getByRole('heading', { name: 'Your photo update', exact: true }).waitFor();
  assert.equal(await page.getByText('Text and damage analysis are unavailable in local mode.', { exact: false }).count(), 1);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await mkdir('../../.local', { recursive: true });
  await page.screenshot({ path: '../../.local/photo-portal-mobile.png', fullPage: true });
  const reviewed = await bridge.call('review_evidence', { claim_id: data.claim_id }, randomUUID(), []);
  assert.equal(reviewed.status, 'ok');
  const evidence = (reviewed.data as { evidence: { label: string }[] }).evidence;
  assert.equal(evidence.length, 1); assert.equal(evidence[0].label, 'Scene wide');
  assert.deepEqual(errors, []);
  await page.goto('http://localhost:3003/upload?token=' + 'a'.repeat(43));
  await page.getByRole('alert').filter({ hasText: 'invalid or expired' }).waitFor();
  console.log(JSON.stringify({ claimId: data.claim_id, received: evidence.length, passed: ['mobile upload', 'token removed from URL', 'label selection preserves preview', 'asynchronous quality gate', 'dark-photo retake', 'unusable photo not forwarded', 'fresh MCP review_evidence', 'invalid token', 'no browser errors'] }, null, 2));
} finally { await browser.close(); }
