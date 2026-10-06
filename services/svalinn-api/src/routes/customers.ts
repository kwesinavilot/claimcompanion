import type { FastifyInstance } from 'fastify';
import { customers } from '../store/seed.js';

export function customerRoutes(app: FastifyInstance) {
  // Lookup only: this POST changes no customer, policy, or claim state.
  app.post<{ Body: { externalCustomerId?: string; phone?: string; policyNumber?: string } }>('/v1/customers/resolve', {
    schema: { body: { type: 'object', additionalProperties: false, properties: {
      externalCustomerId: { type: 'string', minLength: 1 }, phone: { type: 'string', minLength: 1 }, policyNumber: { type: 'string', minLength: 1 },
    }, oneOf: [ { required: ['externalCustomerId'], not: { anyOf: [{ required: ['phone'] }, { required: ['policyNumber'] }] } },
      { required: ['phone', 'policyNumber'], not: { required: ['externalCustomerId'] } } ] } },
  }, async (request, reply) => {
    const body = request.body;
    const record = customers.find(entry => entry.tenantId === request.headers['x-svalinn-tenant'] && (
      body.externalCustomerId ? entry.customer.externalCustomerId === body.externalCustomerId :
        entry.customer.phone === body.phone && entry.policies.some(policy => policy.policyNumber === body.policyNumber)
    ));
    if (!record) return reply.code(404).send({ status: 'error', error: { code: 'CUSTOMER_NOT_FOUND', message: 'No customer matches the given reference.' }, requestId: request.id });
    const policy = body.policyNumber ? record.policies.find(policy => policy.policyNumber === body.policyNumber) : undefined;
    if (policy ? policy.status !== 'ACTIVE' : !record.policies.some(policy => policy.status === 'ACTIVE')) {
      return reply.code(422).send({ status: 'error', error: { code: 'POLICY_NOT_ACTIVE', message: 'The policy is not active.' }, requestId: request.id });
    }
    return { status: 'ok', data: { customer: record.customer, policies: record.policies }, requestId: request.id };
  });
}
