import { buildHttpServer } from '../../mcp-server/src/server.js';
import { McpBridge } from '../../../apps/echo-sim/server/bridge.js';
import { Orchestrator } from '../../../apps/echo-sim/server/orchestrator.js';
import { DemoPlanner } from '../../../apps/echo-sim/server/model.js';

// Fresh process, fresh MCP server and empty conversation; only Svalinn has claim state.
const server = buildHttpServer({ baseUrl: process.env.SVALINN_API_BASE_URL ?? '', apiKey: process.env.SVALINN_API_KEY ?? '', tenantId: process.env.SVALINN_TENANT_ID ?? '' });
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No server address');
  const orchestrator = new Orchestrator(new McpBridge(`http://127.0.0.1:${address.port}/mcp`), new DemoPlanner(), 'demo');
  const response = await orchestrator.turn('How is my claim going?', [], crypto.randomUUID(), orchestrator.open(process.env.DEMO_CLAIM_ID));
  console.log('RESUME_RESULT=' + JSON.stringify({ text: response.text, result: response.traces[0]?.result }));
} finally { await new Promise<void>(resolve => server.close(() => resolve())); }
