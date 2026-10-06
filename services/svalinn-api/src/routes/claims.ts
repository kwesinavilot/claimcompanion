import type { FastifyInstance } from 'fastify';
import type { ClaimsStore } from '../store/claims.js';
import { tenant } from './write.js';

export function claimRoutes(app: FastifyInstance, store: ClaimsStore) {
  app.get<{ Params: { claimId: string } }>('/v1/claims/:claimId', async request =>
    ({ status: 'ok', data: store.getClaim(tenant(request), request.params.claimId), requestId: request.id }));
}
