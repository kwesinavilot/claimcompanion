import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { EvidenceStore, type PhotoInput } from '../../../services/mcp-server/src/evidence-store.js';
import { SvalinnClient, type SvalinnConfig } from '../../../services/mcp-server/src/svalinn-client.js';
import { photoChecklist } from '../../../services/mcp-server/src/tools/request-photo-upload.js';
import { ToolError } from '../../../services/mcp-server/src/tools/result.js';

export function buildApi(store: EvidenceStore, insurer: SvalinnConfig, origin = 'http://localhost:3003', mode = 'local') {
  const app = Fastify({ logger: false }); // Never log capability tokens or photo content.
  const client = new SvalinnClient(insurer);
  app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 8, fields: 1, parts: 9 } });
  const token = (header: string | undefined) => z.string().regex(/^[A-Za-z0-9_-]{43}$/).parse(header?.replace(/^Bearer /, ''));
  app.addHook('onRequest', async (request, reply) => {
    const allowed = new Set([new URL(origin).origin, 'http://localhost:3003', 'http://127.0.0.1:3003']);
    if (request.headers.origin && !allowed.has(request.headers.origin)) { reply.code(403).send({ error: 'This request is not allowed.' }); return; }
  });
  app.get('/api/session', async request => {
    const value = token(request.headers.authorization);
    const session = store.session(value, insurer.tenantId);
    if (!session) throw new ToolError('UPLOAD_LINK_EXPIRED', 'This link is invalid or expired. Ask your companion for a new photo link.');
    const jobs = store.jobs(value, insurer.tenantId).map(({ bytes, token, claim_id, tenant_id, ...job }) => job);
    return { expiresAt: new Date(session.expires_at).toISOString(), used: !!session.used, checklist: photoChecklist, mode, jobs };
  });
  app.post('/api/photos', async (request, reply) => {
    const value = token(request.headers.authorization);
    const session = store.session(value, insurer.tenantId);
    if (!session) throw new ToolError('UPLOAD_LINK_EXPIRED', 'This link is invalid or expired. Ask your companion for a new photo link.');
    const key = z.string().uuid().parse(request.headers['idempotency-key']);
    if (!request.isMultipart()) { reply.code(400); return { error: 'Choose one or more photos.' }; }
    const files: PhotoInput[] = []; let labels: string[] | undefined;
    for await (const part of request.parts()) {
      if (part.type === 'file') {
        if (part.fieldname !== 'photos' || !['image/jpeg', 'image/png', 'image/webp'].includes(part.mimetype)) throw new Error('INVALID_PHOTO');
        const bytes = await part.toBuffer();
        const valid = part.mimetype === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
          : part.mimetype === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
          : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
        if (!valid) throw new Error('INVALID_PHOTO');
        const filename = part.filename.split(/[\\/]/).pop()!.slice(0, 120);
        files.push({ bytes, filename, mime_type: part.mimetype, label: '' });
      } else {
        if (part.fieldname !== 'labels' || labels || typeof part.value !== 'string') throw new Error('INVALID_PHOTO');
        labels = z.array(z.string().trim().min(1).max(120)).max(8).parse(JSON.parse(part.value));
      }
    }
    if (!files.length || !labels || labels.length !== files.length) throw new Error('INVALID_PHOTO');
    files.forEach((file, index) => { file.label = labels![index]; });
    // Validate live insurer ownership before reserving the batch. No model or image decode here.
    await client.getClaim(session.claim_id, AbortSignal.timeout(3000));
    const fingerprint = createHash('sha256').update(JSON.stringify(files.map(file => ({ filename: file.filename, mime_type: file.mime_type, label: file.label, sha256: createHash('sha256').update(file.bytes).digest('hex') })))).digest('hex');
    const jobs = store.acceptBatch(value, insurer.tenantId, key, fingerprint, files);
    reply.code(202); return { accepted: jobs.length };
  });
  app.setErrorHandler((error, request, reply) => {
    const code = error instanceof ToolError ? error.code : '';
    const status = code === 'UPLOAD_LINK_EXPIRED' ? 410 : code === 'IDEMPOTENCY_KEY_CONFLICT' ? 409
      : (error as { statusCode?: number }).statusCode === 413 ? 413 : error instanceof z.ZodError || (error instanceof Error && error.message === 'INVALID_PHOTO') || error instanceof SyntaxError ? 400 : 503;
    reply.code(status).send({ error: error instanceof ToolError ? error.summary : status === 413 ? 'Each photo must be at most 10 MiB, with at most eight photos.' : status === 400 ? 'Choose up to eight JPEG, PNG or WebP photos and a label for each.' : 'Could not accept these photos. Retry the same batch or check the service connection.' });
  });
  return app;
}
