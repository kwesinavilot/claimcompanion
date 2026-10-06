import type { EvidenceStore, EvidenceJob } from '../../mcp-server/src/evidence-store.js';
import type { SvalinnConfig } from '../../mcp-server/src/svalinn-client.js';
import type { PhotoAnalysis } from './analysis.js';
import { quality, analysisImage, type QualityResult } from './quality.js';

export class EvidenceWorker {
  private timer?: ReturnType<typeof setInterval>;
  private active = new Set<string>();
  constructor(private store: EvidenceStore, private insurer: SvalinnConfig, private analysis: PhotoAnalysis) {}
  start() { this.timer = setInterval(() => this.tick(), 250); this.tick(); }
  stop() { if (this.timer) clearInterval(this.timer); }
  async drained() { while (this.active.size) await new Promise(resolve => setTimeout(resolve, 20)); }
  tick() {
    this.store.pruneJobs();
    for (const job of this.store.pending(this.insurer.tenantId)) {
      if (this.active.size >= 3) break;
      if (this.active.has(job.photo_key)) continue;
      this.active.add(job.photo_key);
      void this.run(job).finally(() => this.active.delete(job.photo_key)).catch(() => {});
    }
  }
  async run(job: EvidenceJob) {
    const save = (update: Parameters<EvidenceStore['updateJob']>[2]) => this.store.updateJob(job.photo_key, job.tenant_id, update);
    try {
      const checked = job.quality_result as QualityResult | undefined ?? await quality(job.bytes);
      save({ quality_result: checked });
      if (!checked.usable) { save({ status: 'failed', error: 'RETAKE_NEEDED' }); return; }
      if (!job.document_id) {
        const form = new FormData();
        form.set('file', new Blob([new Uint8Array(job.bytes)], { type: job.mime_type }), job.filename);
        form.set('kind', 'PHOTO'); form.set('label', job.label);
        const response = await fetch(`${this.insurer.baseUrl.replace(/\/$/, '')}/claims/${encodeURIComponent(job.claim_id)}/documents`, { method: 'POST', body: form,
          headers: { Authorization: `ApiKey ${this.insurer.apiKey}`, 'X-Svalinn-Tenant': job.tenant_id, 'Idempotency-Key': `evidence:${job.photo_key}` }, signal: AbortSignal.timeout(10000), redirect: 'error' });
        const envelope = await response.json() as { status?: string; data?: { documentId?: string } };
        if (!response.ok || envelope.status !== 'ok' || !envelope.data?.documentId) throw new Error('FORWARD_FAILED');
        save({ document_id: envelope.data.documentId });
      }
      const image = await analysisImage(job.bytes);
      // These calls are solely in the background worker, never an MCP response path.
      await Promise.all([
        (async () => { if (!job.ocr_result) save({ ocr_result: await this.analysis.ocr(image) }); })(),
        (async () => { if (!job.damage_result) save({ damage_result: await this.analysis.damage(image) }); })(),
      ]);
      save({ status: 'done' });
    } catch {
      const attempts = job.attempts + 1;
      save({ attempts, ...(attempts >= 3 ? { status: 'failed', error: 'PROCESSING_FAILED' } : {}) });
    }
  }
}
