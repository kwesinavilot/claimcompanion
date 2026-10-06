import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

const base = process.env.SVALINN_API_BASE_URL!;
const run = randomUUID();
async function write(path: string, body: object) {
  const response = await fetch(`${base}${path}`, { method: 'POST', headers: {
    Authorization: `ApiKey ${process.env.SVALINN_API_KEY}`, 'X-Svalinn-Tenant': process.env.SVALINN_TENANT_ID!,
    'Content-Type': 'application/json', 'Idempotency-Key': `${run}-${path}`,
  }, body: JSON.stringify(body) });
  const envelope = await response.json();
  if (!response.ok) throw new Error(`Svalinn smoke setup failed: ${JSON.stringify(envelope)}`);
  return envelope.data;
}
const fnol = await write('/fnols', { externalCustomerId: 'CUST_00234', claimTypeCode: 'MOTOR_GLASS', incidentAt: '2026-10-04T14:10:00Z', narrative: 'The window is cracked.' });
const claim = await write(`/fnols/${fnol.fnolId}/promote`, {});
const endpoint = process.env.MCP_SERVER_URL ?? `http://${process.env.HOST ?? '127.0.0.1'}:${process.env.PORT ?? 3002}/mcp`;
async function read() {
  const client = new Client({ name: 'phase-3-smoke', version: '0.3.0' });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(endpoint)));
    const start = performance.now();
    const result = CallToolResultSchema.parse(await client.callTool({ name: 'get_claim_status', arguments: { claim_id: claim.claimId } }));
    const elapsed = performance.now() - start;
    assert.equal(result.structuredContent?.status, 'ok');
    return { result, elapsed };
  } finally { await client.close(); }
}
const before = await read();
const task = { owner: 'CUSTOMER', text: 'Add one wide photo of the window.' };
await write(`/_mock/claims/${claim.claimId}/tasks`, task);
const after = await read();
assert.equal((after.result.structuredContent?.data as Record<string, unknown>).nextStepSummary, task.text);
console.log(JSON.stringify({ claim_id: claim.claimId, endpoint, before_ms: Math.round(before.elapsed), after_ms: Math.round(after.elapsed), result: after.result.structuredContent }, null, 2));
