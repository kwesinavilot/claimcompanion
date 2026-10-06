import type { FastifyInstance } from 'fastify';
import { claimTypes } from '../store/seed.js';

export function claimTypeRoutes(app: FastifyInstance) {
  app.get('/v1/claim-types', async request => ({ status: 'ok', data: claimTypes, requestId: request.id }));
}
