import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { SvalinnClient } from '../svalinn-client.js';
import { EvidenceStore } from '../evidence-store.js';
import { errorResult, missingClaim, result } from './result.js';

export const photoChecklist = ['Scene wide', 'Your car from all four corners', 'Damage close-up', 'Other car plate'];
export function uploadLink(store: EvidenceStore, tenant: string, claimId: string, key: string, baseUrl: string) {
  const session = store.create(tenant, claimId, key);
  const url = new URL(baseUrl);
  url.searchParams.set('token', session.token);
  return { upload_url: url.toString(), expires_at: new Date(session.expires_at).toISOString(), checklist: photoChecklist };
}
export function registerRequestPhotoUpload(server: McpServer, client: SvalinnClient, store: EvidenceStore, tenant: string, baseUrl: string) {
  server.registerTool('request_photo_upload', {
    description: 'Call when the customer asks how to send photos. Creates an upload link and checklist.',
    inputSchema: z.object({ claim_id: z.string().optional() }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ claim_id }, extra) => {
    if (!claim_id?.trim()) return missingClaim();
    try {
      await client.getClaim(claim_id);
      const key = extra._meta?.['claim-companion/idempotency-key'];
      const data = uploadLink(store, tenant, claim_id, typeof key === 'string' && key.trim() ? `upload:${key}` : `upload:claim:${claim_id}`, baseUrl);
      return result({ status: 'ok', summary: 'Your photo upload link and checklist are ready.', data: { claim_id, ...data } });
    } catch (error) { return errorResult(error); }
  });
}
