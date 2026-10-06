import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { checkSafety } from '../safety.js';
import { SvalinnClient, SvalinnError, type Fnol } from '../svalinn-client.js';
import { errorResult, operationKey, result, ToolError } from './result.js';

export const reportSchema = z.object({
  intake_id: z.string().describe('Omit to start a new report.').optional(),
  claim_type_code: z.enum(['MOTOR_COLLISION', 'MOTOR_HIT_AND_RUN', 'MOTOR_THEFT', 'MOTOR_GLASS', 'MOTOR_WEATHER']).optional(),
  narrative: z.string().optional(), occurred_at: z.string().datetime({ offset: true }).optional(),
  date_confidence: z.enum(['exact', 'approximate', 'unsure']).optional(), location_description: z.string().optional(),
  vehicle_registration_number: z.string().optional(), anyone_injured: z.boolean().optional(), vehicle_drivable: z.boolean().optional(),
  other_parties: z.array(z.object({ role: z.enum(['OTHER_DRIVER', 'PASSENGER', 'PEDESTRIAN', 'WITNESS']).optional(),
    plate_number: z.string().optional(), name: z.string().optional(), phone: z.string().optional() }).passthrough()).optional(),
  police_report_number: z.string().optional(),
}).strict();
type Report = z.infer<typeof reportSchema>;
const questions: Record<string, { field: string; question: string }> = {
  incidentAt: { field: 'occurred_at', question: 'When did the incident happen?' },
  incidentLocation: { field: 'location_description', question: 'Where did the incident happen?' },
  vehicleRegistrationNumber: { field: 'vehicle_registration_number', question: 'What is your vehicle registration number?' },
  narrative: { field: 'narrative', question: 'What happened?' },
  policeReportNumber: { field: 'police_report_number', question: 'What is the police report number?' },
};
export function safetyPause(safety: ReturnType<typeof checkSafety>) {
  return result({ status: 'needs_input', summary: safety.level === 'emergency' ? 'If anyone is hurt or in danger, call your local emergency number now. I can continue when everyone is safe.' : 'Before anything else, I need to check that everyone is safe.',
    data: {}, safety, missing: [{ field: 'anyone_injured', priority: 1, question: 'Is anyone hurt, or are you somewhere unsafe?' }],
    next_question: safety.level === 'emergency' ? 'Are you ready to continue once everyone is safe?' : 'Is anyone hurt, or are you somewhere unsafe?' });
}
export function ensureOwner(fnol: Fnol, customerId: string) {
  if (fnol.externalCustomerId !== customerId) throw new ToolError('FORBIDDEN', 'That report is not linked to this demo account.');
}
function fields(input: Report) {
  const pairs = { claimTypeCode: input.claim_type_code, narrative: input.narrative, incidentAt: input.occurred_at,
    dateConfidence: input.date_confidence, incidentLocation: input.location_description === undefined ? undefined : { description: input.location_description },
    vehicleRegistrationNumber: input.vehicle_registration_number, anyoneInjured: input.anyone_injured, vehicleDrivable: input.vehicle_drivable,
    otherParties: input.other_parties?.map(party => Object.fromEntries(Object.entries({ role: party.role, plateNumber: party.plate_number, name: party.name, phone: party.phone }).filter(([, value]) => value !== undefined))),
    policeReportNumber: input.police_report_number };
  return Object.fromEntries(Object.entries(pairs).filter(([, value]) => value !== undefined));
}
function draftResult(fnol: Fnol) {
  const missing = fnol.missingRequiredFields.map((field, index) => ({ ...(questions[field] ?? { field, question: 'Could you provide the requested detail?' }), priority: index + 1 }));
  return result({ status: fnol.status === 'PROMOTED' ? 'submitted' : missing.length ? 'needs_input' : 'ready_to_review',
    summary: fnol.status === 'PROMOTED' ? 'Your report has already been filed.' : missing.length ? 'I have saved those details. I need a little more information.' : 'Your report is ready for review. Please confirm the details before filing.',
    data: { intake_id: fnol.fnolId, ...(fnol.claimId ? { claim_id: fnol.claimId } : {}), details: fnol }, missing,
    ...(missing[0] ? { next_question: missing[0].question } : {}), safety: { level: 'none' } });
}
export function registerReportIncident(server: McpServer, client: SvalinnClient, customerId: string) {
  server.registerTool('report_incident', {
    description: 'Call when the customer describes an accident or adds/corrects a detail, before or after filing. Returns what is still missing or that it is ready to review.',
    inputSchema: reportSchema, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (input, extra) => {
    // This happens before metadata checks, lookups or writes.
    const safety = checkSafety(input.narrative, input.anyone_injured ?? (input.intake_id ? false : undefined));
    if (safety.level !== 'none') return safetyPause(safety);
    if (!input.intake_id && !input.claim_type_code) return result({ status: 'needs_input', summary: 'I need to know what kind of incident you are reporting.', data: {},
      missing: [{ field: 'claim_type_code', priority: 1, question: 'Was this a collision, hit and run, theft, glass damage, or weather damage?' }],
      next_question: 'Was this a collision, hit and run, theft, glass damage, or weather damage?', safety: { level: 'none' } });
    try {
      const key = operationKey(extra._meta);
      const signal = AbortSignal.timeout(350);
      const body = fields(input);
      if (input.intake_id) {
        const fnol = await client.getFnol(input.intake_id, signal);
        ensureOwner(fnol, customerId);
        // Corrections can explicitly clear an earlier safety flag before further writes.
        const mergedSafety = checkSafety(input.narrative ?? fnol.narrative, input.anyone_injured ?? fnol.anyoneInjured);
        if (mergedSafety.level !== 'none') return safetyPause(mergedSafety);
        if (fnol.status === 'PROMOTED') {
          if (!fnol.claimId) throw new ToolError('INVALID_UPSTREAM_RESPONSE', 'I could not locate the filed claim. Please try again.');
          // Ask Svalinn whether this key already applied as a pre-submission patch.
          // A replay must not create a new note just because promotion happened later.
          try {
            await client.patchFnol(input.intake_id, body, key, signal);
            return draftResult(fnol);
          } catch (error) {
            if (!(error instanceof SvalinnError) || error.code !== 'FNOL_ALREADY_PROMOTED') throw error;
          }
          await client.addNote(fnol.claimId, `Customer correction: ${JSON.stringify(body)}`, `correction:${key}`, signal);
          return result({ status: 'submitted', summary: 'I have recorded your correction for the adjuster.', data: { intake_id: fnol.fnolId, claim_id: fnol.claimId }, safety: { level: 'none' } });
        }
        await client.patchFnol(input.intake_id, body, key, signal);
        return draftResult(await client.getFnol(input.intake_id, signal));
      }
      const draft = await client.createFnol({ externalCustomerId: customerId, ...body }, key, signal);
      return draftResult(await client.getFnol(draft.fnolId, signal));
    } catch (error) { return errorResult(error); }
  });
}
