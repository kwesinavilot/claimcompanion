import type { FastifyInstance } from 'fastify';
import type { ClaimsStore, FnolInput } from '../store/claims.js';
import { createFnolSchema, patchFnolSchema } from './fnol-schema.js';
import { tenant, write } from './write.js';

export function fnolRoutes(app: FastifyInstance, store: ClaimsStore) {
  app.post<{ Body: FnolInput }>('/v1/fnols', { schema: { body: createFnolSchema } }, async (request, reply) =>
    write(store, request, reply, 201, () => store.createFnol(tenant(request), request.body)));
  app.patch<{ Body: FnolInput; Params: { fnolId: string } }>('/v1/fnols/:fnolId', { schema: { body: patchFnolSchema } }, async (request, reply) =>
    write(store, request, reply, 200, () => store.patchFnol(tenant(request), request.params.fnolId, request.body)));
  app.get<{ Params: { fnolId: string } }>('/v1/fnols/:fnolId', async request =>
    ({ status: 'ok', data: store.getFnol(tenant(request), request.params.fnolId), requestId: request.id }));
  app.post<{ Params: { fnolId: string } }>('/v1/fnols/:fnolId/promote', {
    schema: { body: { type: 'object', additionalProperties: false, maxProperties: 0 } },
  }, async (request, reply) => write(store, request, reply, 201, () => store.promote(tenant(request), request.params.fnolId)));
}
