import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { SvalinnClient } from '../svalinn-client.js';
import { EvidenceStore } from '../evidence-store.js';
import { checkSafety } from '../safety.js';
import { ensureOwner, safetyPause } from './report-incident.js';
import { uploadLink } from './request-photo-upload.js';
import { errorResult, result } from './result.js';

export function registerConfirmAndSubmit(server: McpServer, client: SvalinnClient, store: EvidenceStore, customerId: string, tenant: string, baseUrl: string) {
  server.registerTool('confirm_and_submit_claim', {
    description: 'Call only after reading the summary back to the customer and getting an explicit yes.',
    inputSchema: z.object({ intake_id: z.string(), confirmed: z.boolean() }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ intake_id, confirmed }) => {
    if (confirmed !== true) return result({ status: 'error', summary: 'I need your explicit confirmation before filing.', data: { error_code: 'CONFIRMATION_REQUIRED' } });
    try {
      const signal = AbortSignal.timeout(350);
      const fnol = await client.getFnol(intake_id, signal);
      ensureOwner(fnol, customerId);
      const safety = checkSafety(fnol.narrative, fnol.anyoneInjured);
      if (safety.level !== 'none') return safetyPause(safety);
      const claim = await client.promote(intake_id, signal);
      // Submission succeeds independently of link creation; retries still reuse the same claim.
      try {
        const upload = uploadLink(store, tenant, claim.claimId, `submit:${intake_id}`, baseUrl);
        return result({ status: 'submitted', summary: 'Your claim has been filed. Your photo upload link and checklist are ready.',
          data: { intake_id, claim_id: claim.claimId, claim_number: claim.claimNumber, stage: claim.stage, ...upload }, safety: { level: 'none' } });
      } catch {
        return result({ status: 'submitted', summary: 'Your claim has been filed. Please request a new photo upload link.',
          data: { intake_id, claim_id: claim.claimId, claim_number: claim.claimNumber, stage: claim.stage, upload_status: 'unavailable' }, safety: { level: 'none' } });
      }
    } catch (error) { return errorResult(error); }
  });
}
