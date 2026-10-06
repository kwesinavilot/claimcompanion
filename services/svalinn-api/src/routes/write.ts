import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ClaimsStore } from '../store/claims.js';

export const tenant = (request: FastifyRequest) => request.headers['x-svalinn-tenant'] as string;
export function write(store: ClaimsStore, request: FastifyRequest, reply: FastifyReply, statusCode: number, action: () => unknown, body: unknown = request.body) {
  const result = store.write(tenant(request), `${request.method} ${request.url.split('?')[0]}`, request.headers['idempotency-key'], body, () => ({ statusCode, data: action() }));
  return reply.code(result.statusCode).send({ status: 'ok', data: result.data, requestId: request.id });
}
