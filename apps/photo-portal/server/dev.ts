import { createServer } from 'vite';
import { resolve } from 'node:path';
import { EvidenceStore } from '../../../services/mcp-server/src/evidence-store.js';
import { EvidenceWorker } from '../../../services/evidence-pipeline/src/worker.js';
import { AwsAnalysis, UnavailableAnalysis } from '../../../services/evidence-pipeline/src/analysis.js';
import { buildApi } from './api.js';

const config = { baseUrl: process.env.SVALINN_API_BASE_URL ?? '', apiKey: process.env.SVALINN_API_KEY ?? '', tenantId: process.env.SVALINN_TENANT_ID ?? '' };
const store = new EvidenceStore(resolve(process.env.EVIDENCE_DB_PATH ?? '../../services/mcp-server/.local/evidence.sqlite'));
const mode = process.env.EVIDENCE_ANALYSIS_MODE === 'aws' ? 'aws' : 'local';
const analysis = mode === 'aws' ? new AwsAnalysis(process.env.AWS_REGION ?? 'us-east-1', process.env.BEDROCK_DAMAGE_MODEL_ID ?? '') : new UnavailableAnalysis();
const api = buildApi(store, config, process.env.PHOTO_PORTAL_ORIGIN, mode);
await api.listen({ port: 3005, host: '127.0.0.1' });
const worker = new EvidenceWorker(store, config, analysis); worker.start();
const vite = await createServer(); await vite.listen(); vite.printUrls();
console.log(`Photo pipeline mode: ${mode}; quality checks run asynchronously.`);
let closing = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, async () => {
  if (closing) return; closing = true; worker.stop(); await api.close(); await worker.drained(); store.close(); await vite.close(); process.exit(0);
});
