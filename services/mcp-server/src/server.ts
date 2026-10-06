import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SvalinnClient, type SvalinnConfig } from './svalinn-client.js';
import { registerGetClaimStatus } from './tools/get-claim-status.js';

export function buildHttpServer(config: SvalinnConfig) {
  const client = new SvalinnClient(config); // Configuration only, no claim cache.
  const app = createServer(async (request, response) => {
    if (request.url?.split('?')[0] !== '/mcp') { response.writeHead(404).end(); return; }
    if (request.method !== 'POST') {
      response.writeHead(405, { Allow: 'POST', 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null }));
      return;
    }
    const server = new McpServer({ name: 'claim-companion', version: '0.3.0' });
    registerGetClaimStatus(server, client);
    const address = app.address();
    const port = address && typeof address === 'object' ? address.port : 3002;
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true,
      enableDnsRebindingProtection: true, allowedHosts: [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`],
      allowedOrigins: ['http://localhost:6274', 'http://127.0.0.1:6274'] });
    response.on('close', () => { void server.close().catch(() => {}); });
    try {
      await server.connect(transport);
      await transport.handleRequest(request, response);
    } catch {
      if (!response.headersSent) { response.writeHead(500, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error.' }, id: null })); }
      else response.end();
    }
  });
  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = buildHttpServer({ baseUrl: process.env.SVALINN_API_BASE_URL ?? '', apiKey: process.env.SVALINN_API_KEY ?? '', tenantId: process.env.SVALINN_TENANT_ID ?? '' });
  const host = process.env.HOST ?? '127.0.0.1';
  const port = Number(process.env.PORT ?? 3002);
  app.listen(port, host, () => {
    const address = app.address();
    console.info(`Claim Companion MCP listening at http://${host}:${address && typeof address === 'object' ? address.port : port}/mcp`);
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => app.close(() => process.exit(0)));
}
