import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { checkSafety } from '../../../services/mcp-server/src/safety.js';
import type { Message, Stage, TurnResponse, Card, Trace } from '../src/types.js';
import type { Planner } from './model.js';
import { McpBridge } from './bridge.js';

interface Flow { safety: boolean; consent: boolean; stage: Stage; intakeId?: string; claimId?: string; pending?: string; reviewHash?: string; expires: number }
const affirmative = /^(?:yes(?:[,!\s]+(?:please|file it|go ahead|submit it|file the claim|that is correct|that's correct))?|file it|yes,?\s+file it|submit the claim)[.!\s]*$/i;
const safeAnswer = /^(?:no|no one (?:is |was )?(?:hurt|injured)|nobody (?:was |is )?hurt|everyone (?:is )?safe|we(?:'re| are) safe|all safe)[.!\s]*$/i;
const clearlySafe = /\b(?:nobody (?:was |is )?hurt|no injuries|everyone (?:is )?safe|no one (?:was |is )?injured)\b/i;
const hash = (details: unknown) => createHash('sha256').update(JSON.stringify(details)).digest('hex');
const safetyText = 'If anyone is hurt or in danger, call your local emergency number now. I can continue when everyone is safe.';

export class Orchestrator {
  private secret = randomBytes(32);
  constructor(private bridge: Pick<McpBridge, 'tools' | 'call'>, private planner: Planner, public mode: 'demo' | 'bedrock') {}
  private sign(state: Flow) {
    const payload = Buffer.from(JSON.stringify({ ...state, expires: Date.now() + 60 * 60 * 1000 })).toString('base64url');
    return `${payload}.${createHmac('sha256', this.secret).update(payload).digest('base64url')}`;
  }
  private read(token?: string): Flow {
    if (!token) return { safety: false, consent: false, stage: 'safety', expires: 0 };
    const [payload, signature] = token.split('.');
    const expected = createHmac('sha256', this.secret).update(payload ?? '').digest();
    const received = Buffer.from(signature ?? '', 'base64url');
    if (received.length !== expected.length || !timingSafeEqual(expected, received)) throw new Error('SESSION_EXPIRED');
    const state = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Flow;
    if (state.expires <= Date.now()) throw new Error('SESSION_EXPIRED');
    return state;
  }
  open(claimId?: string) {
    return this.sign({ safety: false, consent: false, stage: claimId ? 'submitted' : 'safety', claimId, expires: 0 });
  }
  async turn(message: string, history: Message[], messageId: string, continuation?: string): Promise<TurnResponse> {
    const state = this.read(continuation);
    const traces: Trace[] = [];
    const reply = (text: string, card?: Card): TurnResponse => ({ text, continuation: this.sign(state), stage: state.stage, traces, card, mode: this.mode });
    // Always run before model calls, metadata processing or claim writes.
    if (checkSafety(message, false).level === 'emergency') { state.safety = false; state.stage = 'emergency'; state.reviewHash = undefined; return reply(safetyText); }
    if (/\b(covered|coverage|fault|liability|repair cost|denied|denial|legal advice|medical advice)\b/i.test(message)) return reply('An adjuster can help with that. I can help you report an incident or check a claim.');
    const isRead = /\b(status|progress|going|arrived|received|evidence|upload|photo link|send photos)\b/i.test(message);
    if (!isRead && !state.safety) {
      if (clearlySafe.test(message) || (['safety', 'emergency'].includes(state.stage) && safeAnswer.test(message))) state.safety = true;
      else { state.stage = 'safety'; return reply('Before anything else, is anyone hurt or are you somewhere unsafe?'); }
    }
    if (!isRead && !state.consent) {
      if (state.stage === 'consent' && /^no[.!\s]*$/i.test(message)) return reply('No report has been started. Tell me when you would like to continue.');
      if (state.stage === 'consent' && affirmative.test(message)) state.consent = true;
      else { state.stage = 'consent'; return reply('Would you like to file a claim for this incident?'); }
    }
    const call = (name: string, args: Record<string, unknown>, suffix = name) => this.bridge.call(name, args, `${messageId}:${suffix}`, traces);
    const adopt = (output: Record<string, unknown>): TurnResponse => {
      const data = (output.data ?? {}) as Record<string, unknown>;
      if ((output.safety as { level?: string } | undefined)?.level === 'emergency') { state.stage = 'emergency'; state.safety = false; state.reviewHash = undefined; return reply(safetyText); }
      if (output.status === 'error') return reply(typeof output.summary === 'string' ? output.summary : 'I could not complete that request. Please try again.');
      if (typeof data.intake_id === 'string') state.intakeId = data.intake_id;
      if (typeof data.claim_id === 'string') state.claimId = data.claim_id;
      const details = data.details as Record<string, unknown> | undefined;
      const card: Card = { intakeId: state.intakeId, claimId: state.claimId, details, uploadUrl: typeof data.upload_url === 'string' ? data.upload_url : undefined };
      if (output.status === 'ready_to_review' && details) {
        state.stage = 'review'; state.reviewHash = hash(details); state.pending = undefined;
        const location = (details.incidentLocation as { description?: string })?.description;
        const date = typeof details.incidentAt === 'string' ? new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(details.incidentAt)) + ' UTC' : undefined;
        const readback = [date, location, details.vehicleRegistrationNumber ? `vehicle ${details.vehicleRegistrationNumber}` : undefined].filter(Boolean).join(', ');
        return reply(`Here is your report${readback ? `: ${readback}` : ''}. Is that correct, and would you like me to file it?`, card);
      }
      if (output.status === 'submitted') { state.stage = 'submitted'; state.reviewHash = undefined; return reply('Your claim has been filed. You can ask me about its progress any time.', card); }
      if (output.status === 'needs_input') {
        state.stage = state.intakeId ? 'intake' : state.stage;
        state.pending = (output.missing as { field: string }[] | undefined)?.[0]?.field;
        state.reviewHash = undefined;
        return reply(typeof output.next_question === 'string' ? output.next_question : String(output.summary), card);
      }
      const next = data.nextStepSummary;
      const unsafeSpeech = typeof next === 'string' && /\b(coverage|covered|fault|cost|denial|denied|clm_|fnol_)\b/i.test(next);
      return reply(typeof next === 'string' && !unsafeSpeech ? next.slice(0, 240) : String(output.summary), card);
    };
    if (state.stage === 'review' && affirmative.test(message) && state.intakeId && state.reviewHash) {
      const refreshed = await call('report_incident', { intake_id: state.intakeId }, 'verify-review');
      if (refreshed.status === 'submitted') return adopt(await call('confirm_and_submit_claim', { intake_id: state.intakeId, confirmed: true }));
      if (refreshed.status !== 'ready_to_review' || hash((refreshed.data as Record<string, unknown>)?.details) !== state.reviewHash) return adopt(refreshed);
      return adopt(await call('confirm_and_submit_claim', { intake_id: state.intakeId, confirmed: true }));
    }
    const tools = await this.bridge.tools();
    const plan = await this.planner.plan(message, history, state, tools);
    if (!tools.some(tool => tool.name === plan.name)) throw new Error('INVALID_MODEL_TOOL');
    if (plan.name === 'confirm_and_submit_claim') return reply('Please review the report first, then say yes, file it when you want to proceed.');
    const args = { ...plan.args };
    if (plan.name === 'report_incident') {
      delete args.claim_id;
      if (state.intakeId) args.intake_id = state.intakeId; else delete args.intake_id;
      args.anyone_injured = false;
      if (typeof args.narrative === 'string' && checkSafety(args.narrative, false).level === 'emergency') { state.stage = 'emergency'; state.safety = false; return reply(safetyText); }
      state.reviewHash = undefined;
    } else {
      if (!state.claimId) return reply('Choose an existing claim to check, or tell me about a new incident.');
      args.claim_id = state.claimId;
    }
    return adopt(await call(plan.name, args));
  }
}
