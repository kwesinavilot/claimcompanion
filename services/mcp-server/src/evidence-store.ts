import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { ToolError } from './tools/result.js';

export interface UploadSession { token: string; tenant_id: string; claim_id: string; created_at: number; expires_at: number; used: number }
export interface PhotoInput { bytes: Buffer; filename: string; mime_type: string; label: string }
export interface EvidenceJob extends PhotoInput { photo_key: string; token: string; tenant_id: string; claim_id: string; status: 'pending' | 'done' | 'failed'; attempts: number; quality_result?: unknown; ocr_result?: unknown; damage_result?: unknown; document_id?: string; error?: string }
export class EvidenceStore {
  private db: DatabaseSync;
  constructor(path: string, private clock = Date.now) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path, { timeout: 50 });
    this.db.exec(`CREATE TABLE IF NOT EXISTS upload_sessions (
      token TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, claim_id TEXT NOT NULL, operation_key TEXT NOT NULL,
      created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0,
      UNIQUE (tenant_id, operation_key));
      CREATE TABLE IF NOT EXISTS upload_batches (token TEXT PRIMARY KEY, operation_key TEXT NOT NULL, fingerprint TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS evidence_jobs (
        photo_key TEXT PRIMARY KEY, token TEXT NOT NULL, tenant_id TEXT NOT NULL, claim_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
        bytes BLOB NOT NULL, filename TEXT NOT NULL, mime_type TEXT NOT NULL, label TEXT NOT NULL,
        quality_result TEXT, ocr_result TEXT, damage_result TEXT, document_id TEXT, error TEXT);`);
  }
  create(tenant: string, claimId: string, key: string): UploadSession {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const existing = this.db.prepare('SELECT * FROM upload_sessions WHERE tenant_id = ? AND operation_key = ?').get(tenant, key) as unknown as UploadSession | undefined;
      if (existing) {
        if (existing.claim_id !== claimId) throw new ToolError('IDEMPOTENCY_KEY_CONFLICT', 'This request conflicts with an earlier request. Please start a new request.');
        if (existing.expires_at <= this.clock() || existing.used) throw new ToolError('UPLOAD_LINK_EXPIRED', 'That upload link has expired or was already used. Please request a new link.');
        this.db.exec('COMMIT');
        return existing;
      }
      const created = this.clock();
      const session: UploadSession = { token: randomBytes(32).toString('base64url'), tenant_id: tenant, claim_id: claimId, created_at: created, expires_at: created + 30 * 60 * 1000, used: 0 };
      this.db.prepare('INSERT INTO upload_sessions (token, tenant_id, claim_id, operation_key, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(session.token, tenant, claimId, key, session.created_at, session.expires_at);
      this.db.exec('COMMIT');
      return session;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  get(token: string, tenant: string): UploadSession | undefined {
    const session = this.db.prepare('SELECT * FROM upload_sessions WHERE token = ? AND tenant_id = ? AND used = 0 AND expires_at > ?').get(token, tenant, this.clock());
    return session as unknown as UploadSession | undefined;
  }
  session(token: string, tenant: string): UploadSession | undefined {
    return this.db.prepare('SELECT * FROM upload_sessions WHERE token = ? AND tenant_id = ? AND expires_at > ?').get(token, tenant, this.clock()) as unknown as UploadSession | undefined;
  }
  acceptBatch(token: string, tenant: string, key: string, fingerprint: string, photos: PhotoInput[]): EvidenceJob[] {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const session = this.session(token, tenant);
      if (!session) throw new ToolError('UPLOAD_LINK_EXPIRED', 'This upload link is invalid or expired. Request a new link.');
      const existing = this.db.prepare('SELECT * FROM upload_batches WHERE token = ?').get(token) as { operation_key: string; fingerprint: string } | undefined;
      if (existing) {
        if (existing.operation_key !== key || existing.fingerprint !== fingerprint) throw new ToolError('IDEMPOTENCY_KEY_CONFLICT', 'This link already accepted a different batch. Request a new link.');
      } else {
        if (session.used || !photos.length || photos.length > 8) throw new ToolError('UPLOAD_LINK_EXPIRED', 'This link cannot accept this batch. Request a new link.');
        this.db.prepare('INSERT INTO upload_batches VALUES (?, ?, ?)').run(token, key, fingerprint);
        const insert = this.db.prepare('INSERT INTO evidence_jobs (photo_key, token, tenant_id, claim_id, bytes, filename, mime_type, label) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
        for (const photo of photos) insert.run(randomBytes(24).toString('hex'), token, tenant, session.claim_id, photo.bytes, photo.filename, photo.mime_type, photo.label);
        this.db.prepare('UPDATE upload_sessions SET used = 1 WHERE token = ?').run(token);
      }
      const jobs = this.jobs(token, tenant);
      this.db.exec('COMMIT'); return jobs;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  private decode(row: Record<string, unknown>): EvidenceJob {
    const result = { ...row, bytes: row.bytes ? Buffer.from(row.bytes as Uint8Array) : Buffer.alloc(0) } as unknown as EvidenceJob;
    for (const field of ['quality_result', 'ocr_result', 'damage_result'] as const) result[field] = typeof row[field] === 'string' ? JSON.parse(row[field]) : undefined;
    return result;
  }
  jobs(token: string, tenant: string): EvidenceJob[] {
    return this.db.prepare('SELECT photo_key, token, tenant_id, claim_id, status, attempts, filename, mime_type, label, quality_result, ocr_result, damage_result, document_id, error FROM evidence_jobs WHERE token = ? AND tenant_id = ? ORDER BY rowid').all(token, tenant).map(row => this.decode(row));
  }
  pending(tenant: string): EvidenceJob[] {
    return this.db.prepare("SELECT * FROM evidence_jobs WHERE status = 'pending' AND tenant_id = ? ORDER BY rowid LIMIT 20").all(tenant).map(row => this.decode(row));
  }
  updateJob(key: string, tenant: string, update: Partial<Pick<EvidenceJob, 'status' | 'attempts' | 'quality_result' | 'ocr_result' | 'damage_result' | 'document_id' | 'error'>>): void {
    const allowed = ['status', 'attempts', 'quality_result', 'ocr_result', 'damage_result', 'document_id', 'error'];
    const fields = Object.keys(update).filter(field => allowed.includes(field));
    if (!fields.length) return;
    const values = fields.map(field => field.endsWith('_result') ? JSON.stringify(update[field as keyof typeof update]) : update[field as keyof typeof update]) as (string | number)[];
    this.db.prepare(`UPDATE evidence_jobs SET ${fields.map(field => `${field} = ?`).join(', ')} WHERE photo_key = ? AND tenant_id = ?`).run(...values, key, tenant);
    if (update.status === 'done' || update.status === 'failed') this.db.prepare("UPDATE evidence_jobs SET bytes = X'' WHERE photo_key = ? AND tenant_id = ?").run(key, tenant);
  }
  pruneJobs(): void {
    // Evidence working data shares the upload-session TTL; no second claim archive.
    this.db.prepare('DELETE FROM evidence_jobs WHERE token IN (SELECT token FROM upload_sessions WHERE expires_at <= ?)').run(this.clock());
  }
  close() { this.db.close(); }
}
