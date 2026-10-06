import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Trace } from '../src/types.js';

export class McpBridge {
  constructor(private endpoint: string) {}
  private async connect() {
    const client = new Client({ name: 'claim-companion-echo-sim', version: '0.5.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(this.endpoint)));
    return client;
  }
  async tools() {
    const client = await this.connect();
    try { return (await client.listTools()).tools; } finally { await client.close(); }
  }
  async call(name: string, args: Record<string, unknown>, key: string, traces: Trace[]) {
    const client = await this.connect();
    try {
      const start = performance.now();
      const result = CallToolResultSchema.parse(await client.callTool({ name, arguments: args, _meta: { 'claim-companion/idempotency-key': key } }));
      const output = result.structuredContent;
      if (!output) throw new Error('Tool returned no structured content.');
      traces.push({ name, arguments: args, result: output, ms: Math.round(performance.now() - start) });
      return output;
    } finally { await client.close(); }
  }
}
