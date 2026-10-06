import type { FastifyInstance } from 'fastify';
import { stages, type ClaimsStore, type Owner, type Stage } from '../store/claims.js';
import { tenant, write } from './write.js';

export function mockRoutes(app: FastifyInstance, store: ClaimsStore) {
  app.post<{ Params: { claimId: string }; Body: { owner: Owner; text: string } }>('/v1/_mock/claims/:claimId/tasks', {
    schema: { body: { type: 'object', additionalProperties: false, required: ['owner', 'text'], properties: {
      owner: { type: 'string', enum: ['CUSTOMER', 'INSURER', 'REPAIRER'] }, text: { type: 'string', minLength: 1, pattern: '\\S' },
    } } },
  }, async (request, reply) => write(store, request, reply, 201, () => store.addTask(tenant(request), request.params.claimId, request.body)));
  app.patch<{ Params: { claimId: string }; Body: { stage: Stage } }>('/v1/_mock/claims/:claimId/stage', {
    schema: { body: { type: 'object', additionalProperties: false, required: ['stage'], properties: { stage: { type: 'string', enum: stages } } } },
  }, async (request, reply) => write(store, request, reply, 200, () => store.setStage(tenant(request), request.params.claimId, request.body.stage)));
}
