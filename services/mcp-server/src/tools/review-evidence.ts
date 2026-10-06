import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { SvalinnClient } from '../svalinn-client.js';
import { errorResult, missingClaim, result } from './result.js';

export function registerReviewEvidence(server: McpServer, client: SvalinnClient) {
  server.registerTool('review_evidence', {
    description: 'Call when the customer asks if photos arrived or what is still needed.',
    inputSchema: z.object({ claim_id: z.string().optional() }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ claim_id }) => {
    if (!claim_id?.trim()) return missingClaim();
    try {
      const claim = await client.getClaim(claim_id);
      return result({ status: 'ok', summary: claim.evidence.length ? 'Your evidence has arrived. Here is what is still needed.' : 'No evidence has arrived yet.',
        data: { claim_id, evidence: claim.evidence, openTasks: claim.openTasks } });
    } catch (error) { return errorResult(error); }
  });
}
