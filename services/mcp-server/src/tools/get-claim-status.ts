import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { SvalinnClient, SvalinnError } from '../svalinn-client.js';

export function registerGetClaimStatus(server: McpServer, client: SvalinnClient) {
  server.registerTool('get_claim_status', {
    description: 'Call when the customer asks about progress or next steps. Returns stage, who has the next move, and the next step in plain language.',
    inputSchema: z.object({ claim_id: z.string().optional() }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ claim_id }) => {
    if (!claim_id?.trim()) {
      const result = { status: 'needs_input', summary: 'I need to know which claim you want to check.', data: {},
        missing: [{ field: 'claim_id', priority: 1, question: 'Which claim would you like me to check?' }], next_question: 'Which claim would you like me to check?' };
      return { content: [{ type: 'text' as const, text: result.summary }], structuredContent: result };
    }
    try {
      const claim = await client.getClaim(claim_id);
      // Keep the voice summary deterministic; adjuster text stays unchanged in structured data.
      const summary = claim.nextMove === 'CUSTOMER' ? 'The next step is with you.' : claim.nextMove === 'REPAIRER' ? 'The next step is with the repairer.' : 'The next step is with the insurer.';
      const result = { status: 'ok', summary, data: { claim_id: claim.claimId, claim_number: claim.claimNumber, stage: claim.stage,
        nextMove: claim.nextMove, nextStepSummary: claim.nextStepSummary, openTasks: claim.openTasks, evidence: claim.evidence, timeline: claim.timeline } };
      return { content: [{ type: 'text' as const, text: summary }], structuredContent: result };
    } catch (error) {
      const upstream = error instanceof SvalinnError ? error : new SvalinnError('UPSTREAM_UNAVAILABLE');
      const summary = upstream.code === 'CLAIM_NOT_FOUND' ? 'I could not find that claim.' : 'I could not check your claim just now. Please try again.';
      const result = { status: 'error', summary, data: { error_code: upstream.code, ...(upstream.requestId ? { request_id: upstream.requestId } : {}) } };
      return { isError: true, content: [{ type: 'text' as const, text: summary }], structuredContent: result };
    }
  });
}
