import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Trace } from '../src/types.js';
import { EXTENSION_ID, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';

export class McpBridge {
  constructor(private endpoint: string) {}
  private async connect() {
    const client = new Client({ name: 'claim-companion-echo-sim', version: '0.6.0' }, { capabilities: { extensions: { [EXTENSION_ID]: { mimeTypes: [RESOURCE_MIME_TYPE] } } } });
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
      const tool = (await client.listTools()).tools.find(tool => tool.name === name);
      const uiUri = (tool?._meta?.ui as { resourceUri?: string } | undefined)?.resourceUri;
      const start = performance.now();
      const result = CallToolResultSchema.parse(await client.callTool({ name, arguments: args, _meta: { 'claim-companion/idempotency-key': key } }));
      const output = result.structuredContent;
      if (!output) throw new Error('Tool returned no structured content.');
      traces.push({ name, arguments: args, result: output, ms: Math.round(performance.now() - start), uiUri });
      return output;
    } finally { await client.close(); }
  }
  async view(uri: string) {
    if (!['ui://claims/intake-summary', 'ui://claims/evidence-checklist', 'ui://claims/status-timeline'].includes(uri)) throw new Error('UNKNOWN_VIEW');
    const client = await this.connect();
    try {
      const response = await client.readResource({ uri });
      const item = response.contents.find(item => item.uri === uri && item.mimeType === RESOURCE_MIME_TYPE && 'text' in item);
      if (!item || !('text' in item)) throw new Error('MISSING_VIEW');
      return item.text;
    } finally { await client.close(); }
  }
}
