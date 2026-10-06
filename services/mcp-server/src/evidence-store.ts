import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { ToolError } from './tools/result.js';

export interface UploadSession { token: string; tenant_id: string; claim_id: string; created_at: number; expires_at: number; used: number }
export class EvidenceStore {
  private db: DatabaseSync;
  constructor(path: string, private clock = Date.now) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path, { timeout: 50 });
    this.db.exec(`CREATE TABLE IF NOT EXISTS upload_sessions (
      token TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, claim_id TEXT NOT NULL, operation_key TEXT NOT NULL,
      created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0,
      UNIQUE (tenant_id, operation_key));`);
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
  close() { this.db.close(); }
}
