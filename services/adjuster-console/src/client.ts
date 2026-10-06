export const stages = ['SUBMITTED', 'ACKNOWLEDGED', 'INFO_REQUESTED', 'ESTIMATE_PENDING', 'ESTIMATE_RECEIVED', 'IN_REPAIR', 'COMPLETED', 'WITHDRAWN'] as const;
export const defaultRequest = 'Add one photo of the rear bumper from about ten feet back.';
export interface Claim { claimId: string; claimNumber: string; stage: string; nextMove: string; nextStepSummary: string; openTasks: { taskId: string; owner: string; text: string; createdAt: string }[]; evidence: { documentId: string; label?: string; kind: string; uploadedAt: string }[]; timeline: { at: string; event: string }[] }
export interface Operation { claimId: string; type: 'task' | 'stage'; key: string; body: { owner: string; text: string } | { stage: string } }
export function operation(claimId: string, type: Operation['type'], body: Operation['body']): Operation { return { claimId, type, body, key: crypto.randomUUID() }; }
export async function readClaim(id: string): Promise<Claim> {
  const response = await fetch(`/svalinn/v1/claims/${encodeURIComponent(id)}`, { cache: 'no-store' });
  const body = await response.json();
  if (!response.ok || body.status !== 'ok') throw new Error('Could not open this claim. Check the reference and that Svalinn is running.');
  return body.data;
}
export async function write(op: Operation): Promise<void> {
  const path = `/svalinn/v1/_mock/claims/${encodeURIComponent(op.claimId)}/${op.type === 'task' ? 'tasks' : 'stage'}`;
  const response = await fetch(path, { method: op.type === 'task' ? 'POST' : 'PATCH', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': op.key }, body: JSON.stringify(op.body) });
  const body = await response.json();
  if (!response.ok || body.status !== 'ok') throw new Error('Could not finish this action. Retry the same action safely.');
}
