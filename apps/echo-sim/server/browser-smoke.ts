import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { sampleReport } from '../src/types.js';

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  // tsx preserves names with this helper in serialized functions.
  await page.addInitScript('window.__name = (value) => value;');
  await page.addInitScript(({ report }) => {
    class Recognition {
      onresult?: (event: unknown) => void; onend?: () => void;
      start() { setTimeout(() => this.onresult?.({ results: [{ isFinal: true, 0: { transcript: report } }] }), 50); }
      stop() { this.onend?.(); } abort() { this.onend?.(); }
    }
    Object.defineProperty(window, 'SpeechRecognition', { value: Recognition });
    Object.defineProperty(window, 'speechSynthesis', { value: { cancel() {}, speak() {} } });
  }, { report: sampleReport });
  await page.goto('http://127.0.0.1:5173');
  await page.getByText('Local demo · no model calls', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Start microphone' }).click();
  await page.getByText('Would you like to file a claim for this incident?', { exact: true }).waitFor();
  async function send(text: string) {
    await page.getByRole('textbox', { name: 'Your message' }).fill(text);
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
  }
  await send('Yes');
  await page.getByRole('button', { name: 'Yes, file it' }).waitFor();
  await send('Actually it was Elm Street, not Oak Street.');
  await page.getByLabel('Report details').getByText('Elm Street', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Yes, file it' }).click();
  await page.getByText('Your claim is in.', { exact: true }).waitFor();
  const claimId = await page.locator('.filed-card code').innerText();
  assert.match(claimId, /^clm_/);
  await mkdir('../../.local', { recursive: true });
  await page.screenshot({ path: '../../.local/echo-sim-desktop.png', fullPage: true });
  await page.getByRole('button', { name: /Check in later/ }).click();
  await send('How is my claim going?');
  await page.locator('.trace summary').filter({ hasText: 'get_claim_status' }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '../../.local/echo-sim-mobile.png', fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Mobile page must fit viewport');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ claimId, passed: ['synthetic speech event', 'consent', 'real MCP intake', 'correction', 'explicit filing', 'new-session status', 'mobile layout', 'no browser errors'] }, null, 2));
} finally { await browser.close(); }
