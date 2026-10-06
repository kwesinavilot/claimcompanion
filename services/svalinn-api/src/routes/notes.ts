import type { FastifyInstance } from 'fastify';
import type { ClaimsStore } from '../store/claims.js';
import { tenant, write } from './write.js';

export function noteRoutes(app: FastifyInstance, store: ClaimsStore) {
  app.post<{ Params: { claimId: string }; Body: { note: string } }>('/v1/claims/:claimId/notes', {
    schema: { body: { type: 'object', additionalProperties: false, required: ['note'], properties: { note: { type: 'string', minLength: 1, pattern: '\\S' } } } },
  }, async (request, reply) => write(store, request, reply, 200, () => store.addNote(tenant(request), request.params.claimId, request.body.note)));
}
