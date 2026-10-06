import { createHash, randomUUID } from 'node:crypto';
import { claimTypes, customers } from './seed.js';

export const stages = ['SUBMITTED', 'ACKNOWLEDGED', 'INFO_REQUESTED', 'ESTIMATE_PENDING', 'ESTIMATE_RECEIVED', 'IN_REPAIR', 'COMPLETED', 'WITHDRAWN'] as const;
export type Stage = typeof stages[number];
export type Owner = 'CUSTOMER' | 'INSURER' | 'REPAIRER';
export interface FnolInput {
  externalCustomerId?: string; policyNumber?: string; claimTypeCode?: string;
  vehicleRegistrationNumber?: string; incidentAt?: string; dateConfidence?: 'exact' | 'approximate' | 'unsure';
  incidentLocation?: { description?: string; city?: string; region?: string };
  narrative?: string; anyoneInjured?: boolean; vehicleDrivable?: boolean;
  otherParties?: { role?: string; name?: string | null; phone?: string | null; plateNumber?: string | null; insurerName?: string | null }[];
  policeReportNumber?: string | null;
}
interface Fnol extends FnolInput { tenantId: string; fnolId: string; claimTypeCode: string; externalCustomerId: string; policyNumber: string; status: 'DRAFT' | 'PROMOTED'; claimId?: string }
export interface Claim {
  tenantId: string; claimId: string; claimNumber: string; stage: Stage;
  openTasks: { taskId: string; owner: Owner; text: string; createdAt: string }[];
  evidence: { documentId: string; kind: string; uploadedAt: string; label?: string }[];
  timeline: { at: string; event: string }[];
  notes: { noteId: string; note: string; createdAt: string }[];
}
interface WriteResult { statusCode: number; data: unknown }
export class ApiError extends Error {
  constructor(public statusCode: number, public code: string, message: string, public details?: Record<string, unknown>) { super(message); }
}
const id = (prefix: string) => `${prefix}_${randomUUID()}`;
const now = () => new Date().toISOString();
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, val]) => `${JSON.stringify(key)}:${canonical(val)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
};

const stageSteps: Record<Stage, { nextMove: Owner; nextStepSummary: string }> = {
  SUBMITTED: { nextMove: 'INSURER', nextStepSummary: 'Your claim is filed and waiting to be assigned.' },
  ACKNOWLEDGED: { nextMove: 'INSURER', nextStepSummary: 'An adjuster is reviewing your claim.' },
  INFO_REQUESTED: { nextMove: 'CUSTOMER', nextStepSummary: 'Contact your adjuster to confirm what information is needed.' },
  ESTIMATE_PENDING: { nextMove: 'REPAIRER', nextStepSummary: 'Waiting for a repair estimate.' },
  ESTIMATE_RECEIVED: { nextMove: 'INSURER', nextStepSummary: 'The estimate is in and under review.' },
  IN_REPAIR: { nextMove: 'REPAIRER', nextStepSummary: 'Repairs are in progress.' },
  COMPLETED: { nextMove: 'INSURER', nextStepSummary: 'Your claim is complete. No further action is requested.' },
  WITHDRAWN: { nextMove: 'INSURER', nextStepSummary: 'Your claim has been withdrawn. No further action is requested.' },
};

// Each running Svalinn instance owns its state. No MCP component imports this store.
export class ClaimsStore {
  private fnols = new Map<string, Fnol>();
  private claims = new Map<string, Claim>();
  private documents = new Map<string, { tenantId: string; claimId: string; filename: string; mimeType: string; bytes: Buffer }>();
  private replays = new Map<string, { fingerprint: string; result: WriteResult }>();
  private sequence = 0;

  write(tenantId: string, operation: string, key: unknown, body: unknown, action: () => WriteResult): WriteResult {
    if (typeof key !== 'string' || !key.trim()) throw new ApiError(400, 'VALIDATION_ERROR', 'Idempotency-Key is required on every write.');
    const scope = JSON.stringify([tenantId, operation, key]);
    const fingerprint = createHash('sha256').update(canonical(body)).digest('hex');
    const previous = this.replays.get(scope);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new ApiError(409, 'IDEMPOTENCY_KEY_CONFLICT', 'Idempotency key was reused with a different request body.');
      return structuredClone(previous.result);
    }
    // Actions are synchronous after any upload parsing; mutation and replay registration are atomic on the event loop.
    const result = action();
    this.replays.set(scope, { fingerprint, result: structuredClone(result) });
    return result;
  }

  private fnol(tenantId: string, fnolId: string) {
    const fnol = this.fnols.get(fnolId);
    if (!fnol || fnol.tenantId !== tenantId) throw new ApiError(404, 'FNOL_NOT_FOUND', 'No FNOL exists with that ID for this tenant.');
    return fnol;
  }
  claim(tenantId: string, claimId: string) {
    const claim = this.claims.get(claimId);
    if (!claim || claim.tenantId !== tenantId) throw new ApiError(404, 'CLAIM_NOT_FOUND', 'No claim exists with that ID for this tenant.');
    return claim;
  }
  private resolvePolicy(tenantId: string, input: FnolInput) {
    const record = customers.find(entry => entry.tenantId === tenantId &&
      (!input.externalCustomerId || entry.customer.externalCustomerId === input.externalCustomerId) &&
      (!input.policyNumber || entry.policies.some(policy => policy.policyNumber === input.policyNumber)));
    if (!record) throw new ApiError(404, 'CUSTOMER_NOT_FOUND', 'No customer matches the given reference and policy.');
    const policy = input.policyNumber ? record.policies.find(policy => policy.policyNumber === input.policyNumber)! : record.policies.find(policy => policy.status === 'ACTIVE');
    if (!policy || policy.status !== 'ACTIVE') throw new ApiError(422, 'POLICY_NOT_ACTIVE', 'The policy is not active.');
    if (input.vehicleRegistrationNumber && !policy.vehicles.some(vehicle => vehicle.vehicleRegistrationNumber === input.vehicleRegistrationNumber)) {
      throw new ApiError(422, 'VEHICLE_NOT_ON_POLICY', 'The vehicle is not listed on the selected policy.');
    }
    return { externalCustomerId: record.customer.externalCustomerId, policyNumber: policy.policyNumber };
  }
  private missing(fnol: Fnol) {
    const type = claimTypes.find(type => type.code === fnol.claimTypeCode);
    if (!type) throw new ApiError(400, 'VALIDATION_ERROR', 'Unsupported claim type.');
    return type.requiredFields.filter(field => {
      if (field === 'incidentLocation') return !fnol.incidentLocation?.description?.trim();
      const value = fnol[field as keyof Fnol];
      return value === undefined || value === null || (typeof value === 'string' && !value.trim());
    });
  }
  private draftResult(fnol: Fnol) { return { fnolId: fnol.fnolId, status: fnol.status, missingRequiredFields: this.missing(fnol) }; }
  createFnol(tenantId: string, input: FnolInput) {
    const resolved = this.resolvePolicy(tenantId, input);
    const fnol: Fnol = { ...structuredClone(input), ...resolved, tenantId, fnolId: id('fnol'), claimTypeCode: input.claimTypeCode!, status: 'DRAFT' };
    const result = this.draftResult(fnol);
    this.fnols.set(fnol.fnolId, fnol);
    return result;
  }
  patchFnol(tenantId: string, fnolId: string, input: FnolInput) {
    const current = this.fnol(tenantId, fnolId);
    if (current.status === 'PROMOTED') throw new ApiError(422, 'FNOL_ALREADY_PROMOTED', 'The FNOL has been promoted. Add a claim note instead.');
    const merged = { ...current, ...structuredClone(input),
      ...(input.incidentLocation ? { incidentLocation: { ...current.incidentLocation, ...input.incidentLocation } } : {}) };
    const resolved = this.resolvePolicy(tenantId, merged);
    const updated = { ...merged, ...resolved };
    const result = this.draftResult(updated);
    this.fnols.set(fnolId, updated);
    return result;
  }
  getFnol(tenantId: string, fnolId: string) {
    const { tenantId: _tenant, ...fnol } = this.fnol(tenantId, fnolId);
    return { ...structuredClone(fnol), missingRequiredFields: this.missing(this.fnol(tenantId, fnolId)) };
  }
  promote(tenantId: string, fnolId: string) {
    const fnol = this.fnol(tenantId, fnolId);
    if (fnol.claimId) return this.promotionResult(this.claim(tenantId, fnol.claimId));
    const missingRequiredFields = this.missing(fnol);
    if (missingRequiredFields.length) throw new ApiError(422, 'FNOL_INCOMPLETE', 'Required FNOL fields are missing.', { missingRequiredFields });
    this.resolvePolicy(tenantId, fnol);
    const claim: Claim = { tenantId, claimId: id('clm'), claimNumber: `SV-CLM-${new Date().getUTCFullYear()}-${String(++this.sequence).padStart(6, '0')}`,
      stage: 'SUBMITTED', openTasks: [], evidence: [], notes: [], timeline: [{ at: now(), event: 'CLAIM_FILED' }] };
    this.claims.set(claim.claimId, claim);
    fnol.status = 'PROMOTED';
    fnol.claimId = claim.claimId;
    return this.promotionResult(claim);
  }
  private promotionResult(claim: Claim) { return { claimId: claim.claimId, claimNumber: claim.claimNumber, stage: claim.stage }; }
  getClaim(tenantId: string, claimId: string) {
    const claim = this.claim(tenantId, claimId);
    const task = claim.openTasks[0];
    return structuredClone({ claimId: claim.claimId, claimNumber: claim.claimNumber, stage: claim.stage,
      ...(task ? { nextMove: task.owner, nextStepSummary: task.text } : stageSteps[claim.stage]),
      openTasks: claim.openTasks, evidence: claim.evidence, timeline: claim.timeline });
  }
  addDocument(tenantId: string, claimId: string, upload: { filename: string; mimeType: string; bytes: Buffer; kind: string; label?: string }) {
    const claim = this.claim(tenantId, claimId);
    const document = { documentId: id('doc'), kind: upload.kind, uploadedAt: now(), ...(upload.label !== undefined ? { label: upload.label } : {}) };
    this.documents.set(document.documentId, { tenantId, claimId, filename: upload.filename, mimeType: upload.mimeType, bytes: Buffer.from(upload.bytes) });
    claim.evidence.push(document);
    claim.timeline.push({ at: document.uploadedAt, event: 'EVIDENCE_RECEIVED' });
    return document;
  }
  addNote(tenantId: string, claimId: string, note: string) {
    const claim = this.claim(tenantId, claimId);
    const entry = { noteId: id('note'), note, createdAt: now() };
    claim.notes.push(entry);
    claim.timeline.push({ at: entry.createdAt, event: 'NOTE_ADDED' });
    return { noteId: entry.noteId, createdAt: entry.createdAt };
  }
  addTask(tenantId: string, claimId: string, input: { owner: Owner; text: string }) {
    const claim = this.claim(tenantId, claimId);
    const task = { taskId: id('task'), ...input, createdAt: now() };
    claim.openTasks.push(task);
    if (task.owner === 'CUSTOMER') claim.stage = 'INFO_REQUESTED';
    claim.timeline.push({ at: task.createdAt, event: 'ADJUSTER_REQUESTED_INFO' });
    return task;
  }
  setStage(tenantId: string, claimId: string, stage: Stage) {
    const claim = this.claim(tenantId, claimId);
    if (claim.stage !== stage) { claim.stage = stage; claim.timeline.push({ at: now(), event: `STAGE_CHANGED_${stage}` }); }
    return this.getClaim(tenantId, claimId);
  }
}
