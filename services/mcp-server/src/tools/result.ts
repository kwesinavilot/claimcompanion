import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { SvalinnError } from '../svalinn-client.js';

export interface ToolResult extends Record<string, unknown> {
  status: 'ok' | 'needs_input' | 'ready_to_review' | 'submitted' | 'error'; summary: string; data: Record<string, unknown>;
}
export function result(output: ToolResult): CallToolResult {
  return { ...(output.status === 'error' ? { isError: true } : {}), content: [{ type: 'text', text: output.summary }], structuredContent: output };
}
export class ToolError extends Error {
  constructor(public code: string, public summary: string) { super(code); }
}
export function errorResult(error: unknown): CallToolResult {
  const code = error instanceof ToolError || error instanceof SvalinnError ? error.code : 'INTERNAL_ERROR';
  const summary = error instanceof ToolError ? error.summary : 'I could not complete that request just now. Please try again.';
  return result({ status: 'error', summary, data: { error_code: code, ...(error instanceof SvalinnError && error.requestId ? { request_id: error.requestId } : {}) } });
}
export function operationKey(meta?: Record<string, unknown>) {
  const key = meta?.['claim-companion/idempotency-key'];
  if (typeof key !== 'string' || !key.trim()) throw new ToolError('MISSING_IDEMPOTENCY_KEY', 'I could not save your report safely. Please retry the request.');
  return key;
}
export function missingClaim() {
  return result({ status: 'needs_input', summary: 'I need to know which claim you want to check.', data: {},
    missing: [{ field: 'claim_id', priority: 1, question: 'Which claim would you like me to check?' }], next_question: 'Which claim would you like me to check?' });
}
