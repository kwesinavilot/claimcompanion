import { App } from '@modelcontextprotocol/ext-apps';
import QRCode from 'qrcode';
import './view.css';

const app = new App({ name: 'Claim Companion view', version: '0.8.0' }, {});
const title = document.getElementById('title')!;
const summary = document.getElementById('summary')!;
const facts = document.getElementById('facts')!;
const actions = document.getElementById('actions')!;
const error = document.getElementById('error')!;
let closed = false;
function fact(label: string, value: unknown) {
  if (value === undefined || value === null) return;
  const row = document.createElement('div'); row.className = 'fact';
  const name = document.createElement('span'); name.textContent = label;
  const text = document.createElement('strong'); text.textContent = String(value);
  row.append(name, text); facts.append(row);
}
function button(label: string, action: () => Promise<unknown>) {
  const element = document.createElement('button'); element.textContent = label;
  element.onclick = async () => {
    if (closed) return; element.disabled = true; error.textContent = '';
    try { const result = await action(); if (result && typeof result === 'object' && 'isError' in result && result.isError) throw new Error('Rejected'); } catch { error.textContent = 'That action could not finish. Use the conversation controls to continue.'; }
    finally { if (!closed) element.disabled = false; }
  }; actions.append(element);
}
const message = (text: string) => app.sendMessage({ role: 'user', content: [{ type: 'text', text }] });
app.ontoolresult = async response => {
  if (closed) return;
  const result = response.structuredContent as Record<string, unknown> | undefined;
  if (!result) return;
  const data = (result.data ?? {}) as Record<string, unknown>;
  facts.replaceChildren(); actions.replaceChildren(); error.textContent = '';
  summary.textContent = String(result.summary ?? '');
  const view = document.body.dataset.view;
  if (view === 'intake-summary') {
    title.textContent = 'Let’s check your report';
    const detail = (data.details ?? {}) as Record<string, unknown>;
    fact('When', detail.incidentAt); fact('Where', (detail.incidentLocation as { description?: string })?.description);
    fact('Vehicle', detail.vehicleRegistrationNumber); fact('Your account', detail.narrative);
    fact('Anyone injured', typeof detail.anyoneInjured === 'boolean' ? detail.anyoneInjured ? 'Yes' : 'No' : undefined);
    fact('Drivable', typeof detail.vehicleDrivable === 'boolean' ? detail.vehicleDrivable ? 'Yes' : 'No' : undefined);
    for (const item of (result.missing ?? []) as { question: string }[]) fact('Still needed', item.question);
    if (result.status === 'ready_to_review') { button('Yes, file it', () => message('Yes, file it')); button('Change a detail', () => message('I need to correct a detail.')); }
  } else if (view === 'evidence-checklist') {
    title.textContent = 'A clearer picture';
    for (const shot of (data.checklist ?? []) as string[]) fact('Photo to take', shot);
    for (const document of (data.evidence ?? []) as { label?: string; kind: string }[]) fact('Received', document.label ?? document.kind);
    for (const task of (data.openTasks ?? []) as { text: string }[]) fact('Still needed', task.text);
    if (typeof data.upload_url === 'string') {
      const url = data.upload_url;
      const canvas = document.createElement('canvas'); canvas.setAttribute('aria-label', 'QR code for photo upload link'); facts.append(canvas);
      await QRCode.toCanvas(canvas, url, { width: 176, margin: 2 });
      fact('Photo link expires', data.expires_at);
      button('Open photo upload', () => app.openLink({ url }));
    } else button('Get a photo link', () => message('Send photos'));
    button('Check received photos', () => message('Did my photos arrive?'));
  } else {
    title.textContent = 'Your next step';
    fact('Claim number', data.claim_number); fact('Stage', typeof data.stage === 'string' ? data.stage.replaceAll('_', ' ') : undefined);
    fact('Next move', data.nextMove); fact('What happens next', data.nextStepSummary);
    for (const event of (data.timeline ?? []) as { at: string; event: string }[]) fact(event.at, event.event.replaceAll('_', ' '));
    button('Refresh status', () => message('How is my claim going?'));
    if (app.getHostContext()?.availableDisplayModes?.includes('fullscreen')) button('Expand view', () => app.requestDisplayMode({ mode: 'fullscreen' }));
  }
  void app.sendSizeChanged({ height: document.documentElement.scrollHeight });
};
app.onteardown = async () => { closed = true; document.querySelectorAll('button').forEach(button => { button.disabled = true; }); return {}; };
await app.connect();
