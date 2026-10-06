import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { claimTypeRoutes } from './routes/claim-types.js';
import { customerRoutes } from './routes/customers.js';

export function buildServer(keys: { us: string; gh: string }, logger = false) {
  if (!keys.us || !keys.gh || keys.us === keys.gh) throw new Error('Configure two distinct sandbox API keys.');
  const app = Fastify({ logger, genReqId: () => `req_${randomUUID()}`, ajv: { customOptions: { removeAdditional: false, coerceTypes: false } } });
  const tenants = new Map([[keys.us, 'TEN_001'], [keys.gh, 'TEN_002']]);
  const windows = new Map<string, { count: number; reset: number }>();
  app.addHook('onRequest', async (request, reply) => {
    const auth = request.headers.authorization;
    const key = auth?.startsWith('ApiKey ') ? auth.slice(7) : '';
    const now = Math.floor(Date.now() / 1000);
    const tenant = tenants.get(key);
    let window = tenant ? windows.get(key) : undefined;
    if (!window || window.reset <= now) window = { count: 0, reset: now + 3600 };
    if (tenant) { window.count++; windows.set(key, window); }
    reply.header('X-RateLimit-Limit', 2000).header('X-RateLimit-Remaining', Math.max(0, 2000 - window.count)).header('X-RateLimit-Reset', window.reset);
    const fail = (status: number, code: string, message: string) => reply.code(status).send({ status: 'error', error: { code, message }, requestId: request.id });
    if (!tenant) return fail(401, 'UNAUTHORIZED', 'Missing or invalid API key.');
    if (request.headers['x-svalinn-tenant'] !== tenant) return fail(403, 'FORBIDDEN', 'API key is not authorized for this tenant.');
    if (window.count > 2000) return fail(429, 'RATE_LIMITED', 'Sandbox rate limit exceeded.');
  });
  app.setErrorHandler((error, request, reply) => {
    const errorStatus = error instanceof Error && 'statusCode' in error ? error.statusCode : undefined;
    const status = typeof errorStatus === 'number' && errorStatus >= 400 && errorStatus < 500 ? errorStatus : 500;
    if (status === 500) request.log.error(error);
    reply.code(status).send({ status: 'error', error: { code: status === 500 ? 'INTERNAL_ERROR' : 'VALIDATION_ERROR', message: status === 500 ? 'An internal error occurred.' : 'Malformed request body.' }, requestId: request.id });
  });
  app.setNotFoundHandler((request, reply) => reply.code(404).send({ status: 'error', error: { code: 'NOT_FOUND', message: 'Endpoint not implemented in Phase 1.' }, requestId: request.id }));
  claimTypeRoutes(app);
  customerRoutes(app);
  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = buildServer({ us: process.env.SVALINN_US_API_KEY ?? '', gh: process.env.SVALINN_GH_API_KEY ?? '' }, true);
  await app.listen({ port: Number(process.env.PORT ?? 3001), host: process.env.HOST ?? '127.0.0.1' });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { void app.close().then(() => process.exit(0)); });
}
