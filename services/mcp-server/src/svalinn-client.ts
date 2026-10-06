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
const draftSchema = z.object({ fnolId: z.string(), status: z.enum(['DRAFT', 'PROMOTED']), missingRequiredFields: z.array(z.string()) });
const fnolSchema = draftSchema.extend({ externalCustomerId: z.string(), policyNumber: z.string(), claimTypeCode: z.string(),
  narrative: z.string().optional(), anyoneInjured: z.boolean().optional(), claimId: z.string().optional() }).passthrough();
export type Fnol = z.infer<typeof fnolSchema>;
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
  private async request<T>(path: string, schema: z.ZodType<T>, method = 'GET', body?: Record<string, unknown>, key?: string, signal?: AbortSignal): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method, ...(body ? { body: JSON.stringify(body) } : {}),
        headers: { Authorization: `ApiKey ${this.config.apiKey}`, 'X-Svalinn-Tenant': this.config.tenantId,
          ...(body ? { 'Content-Type': 'application/json' } : {}), ...(key ? { 'Idempotency-Key': key } : {}) },
        signal: signal ?? AbortSignal.timeout(350), redirect: 'error',
      });
      const responseBody: unknown = await response.json();
      const envelope = z.object({ status: z.string(), requestId: z.string() }).passthrough().safeParse(responseBody);
      if (!envelope.success) throw new SvalinnError('INVALID_UPSTREAM_RESPONSE');
      const requestId = envelope.data.requestId;
      // Correlation only: never log claim contents or credentials.
      console.info(JSON.stringify({ service: 'svalinn', requestId, statusCode: response.status }));
      if (!response.ok || envelope.data.status !== 'ok') {
        const error = z.object({ error: z.object({ code: z.string() }) }).safeParse(responseBody);
        throw new SvalinnError(error.success ? error.data.error.code : 'UPSTREAM_ERROR', requestId);
      }
      const result = schema.safeParse(envelope.data.data);
      if (!result.success) throw new SvalinnError('INVALID_UPSTREAM_RESPONSE', requestId);
      return result.data;
    } catch (error) {
      if (error instanceof SvalinnError) throw error;
      throw new SvalinnError(error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name) ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE');
    }
  }
  async getClaim(claimId: string, signal?: AbortSignal): Promise<ClaimStatus> {
    const claim = await this.request(`/claims/${encodeURIComponent(claimId)}`, claimSchema, 'GET', undefined, undefined, signal);
    if (claim.claimId !== claimId) throw new SvalinnError('INVALID_UPSTREAM_RESPONSE');
    return claim;
  }
  getFnol(id: string, signal?: AbortSignal) { return this.request(`/fnols/${encodeURIComponent(id)}`, fnolSchema, 'GET', undefined, undefined, signal); }
  createFnol(body: Record<string, unknown>, key: string, signal?: AbortSignal) { return this.request('/fnols', draftSchema, 'POST', body, key, signal); }
  patchFnol(id: string, body: Record<string, unknown>, key: string, signal?: AbortSignal) { return this.request(`/fnols/${encodeURIComponent(id)}`, draftSchema, 'PATCH', body, key, signal); }
  promote(id: string, signal?: AbortSignal) { return this.request(`/fnols/${encodeURIComponent(id)}/promote`, z.object({ claimId: z.string(), claimNumber: z.string(), stage: z.string() }), 'POST', {}, id, signal); }
  addNote(id: string, note: string, key: string, signal?: AbortSignal) { return this.request(`/claims/${encodeURIComponent(id)}/notes`, z.object({ noteId: z.string(), createdAt: z.string() }), 'POST', { note }, key, signal); }
}
