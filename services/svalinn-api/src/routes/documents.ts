import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { ApiError, type ClaimsStore } from '../store/claims.js';
import { tenant, write } from './write.js';

export function documentRoutes(app: FastifyInstance, store: ClaimsStore) {
  app.post<{ Params: { claimId: string } }>('/v1/claims/:claimId/documents', async (request, reply) => {
    store.claim(tenant(request), request.params.claimId);
    if (!request.isMultipart()) throw new ApiError(400, 'VALIDATION_ERROR', 'Document upload requires multipart/form-data.');
    let upload: { filename: string; mimeType: string; bytes: Buffer } | undefined;
    const fields: Record<string, string> = {};
    for await (const part of request.parts()) {
      if (part.type === 'file') {
        if (part.fieldname !== 'file' || upload) throw new ApiError(400, 'VALIDATION_ERROR', 'Exactly one file field is required.');
        if (!(part.mimetype.startsWith('image/') || part.mimetype === 'application/pdf')) throw new ApiError(400, 'VALIDATION_ERROR', 'The file must be an image or PDF.');
        const bytes = await part.toBuffer();
        if (!bytes.length) throw new ApiError(400, 'VALIDATION_ERROR', 'The file must not be empty.');
        upload = { filename: part.filename, mimeType: part.mimetype, bytes };
      } else {
        if (!['kind', 'label'].includes(part.fieldname) || part.fieldname in fields || typeof part.value !== 'string') throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid or duplicate multipart field.');
        fields[part.fieldname] = part.value;
      }
    }
    if (!upload || !['PHOTO', 'POLICE_REPORT', 'OTHER'].includes(fields.kind)) throw new ApiError(400, 'VALIDATION_ERROR', 'A file and a valid kind are required.');
    const document = { ...upload, kind: fields.kind, ...(fields.label !== undefined ? { label: fields.label } : {}) };
    // Hash file content and logical fields; multipart boundary/order must not affect a replay.
    const fingerprint = { filename: document.filename, mimeType: document.mimeType, kind: document.kind, label: document.label,
      sha256: createHash('sha256').update(document.bytes).digest('hex') };
    return write(store, request, reply, 201, () => store.addDocument(tenant(request), request.params.claimId, document), fingerprint);
  });
}
