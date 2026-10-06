import { z } from 'zod';

const claimSchema = z.object({
  claimId: z.string(), claimNumber: z.string(),
  stage: z.enum(['SUBMITTED', 'ACKNOWLEDGED', 'INFO_REQUESTED', 'ESTIMATE_PENDING', 'ESTIMATE_RECEIVED', 'IN_REPAIR', 'COMPLETED', 'WITHDRAWN']),
  nextMove: z.enum(['CUSTOMER', 'INSURER', 'REPAIRER']), nextStepSummary: z.string(),
  openTasks: z.array(z.object({ taskId: z.string(), owner: z.enum(['CUSTOMER', 'INSURER', 'REPAIRER']), text: z.string(), createdAt: z.string() })),
  evidence: z.array(z.object({ documentId: z.string(), kind: z.string(), uploadedAt: z.string(), label: z.string().optional() })),
  timeline: z.array(z.object({ at: z.string(), event: z.string() })),
});
export type ClaimStatus = z.infer<typeof claimSchema>;
export interface SvalinnConfig { baseUrl: string; apiKey: string; tenantId: string }
export class SvalinnError extends Error {
  constructor(public code: string, public requestId?: string) { super(code); }
}

export class SvalinnClient {
  private baseUrl: string;
  constructor(private config: SvalinnConfig) {
    const url = new URL(config.baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Invalid Svalinn base URL.');
    if (!config.apiKey || !config.tenantId) throw new Error('Configure Svalinn API key and tenant.');
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
  }
  async getClaim(claimId: string): Promise<ClaimStatus> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/claims/${encodeURIComponent(claimId)}`, {
        headers: { Authorization: `ApiKey ${this.config.apiKey}`, 'X-Svalinn-Tenant': this.config.tenantId },
        signal: AbortSignal.timeout(350), redirect: 'error',
      });
      const body: unknown = await response.json();
      const envelope = z.object({ status: z.string(), requestId: z.string() }).passthrough().safeParse(body);
      if (!envelope.success) throw new SvalinnError('INVALID_UPSTREAM_RESPONSE');
      const requestId = envelope.data.requestId;
      // Correlation only: never log claim contents or credentials.
      console.info(JSON.stringify({ service: 'svalinn', requestId, statusCode: response.status }));
      if (!response.ok || envelope.data.status !== 'ok') {
        const error = z.object({ error: z.object({ code: z.string() }) }).safeParse(body);
        throw new SvalinnError(error.success ? error.data.error.code : 'UPSTREAM_ERROR', requestId);
      }
      const result = z.object({ data: claimSchema }).safeParse(body);
      if (!result.success || result.data.data.claimId !== claimId) throw new SvalinnError('INVALID_UPSTREAM_RESPONSE', requestId);
      return result.data.data;
    } catch (error) {
      if (error instanceof SvalinnError) throw error;
      throw new SvalinnError(error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name) ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE');
    }
  }
}
