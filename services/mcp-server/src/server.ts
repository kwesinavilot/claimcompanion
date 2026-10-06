import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SvalinnClient, type SvalinnConfig } from './svalinn-client.js';
import { registerGetClaimStatus } from './tools/get-claim-status.js';
import { registerReportIncident } from './tools/report-incident.js';
import { registerReviewEvidence } from './tools/review-evidence.js';
import { registerConfirmAndSubmit } from './tools/confirm-and-submit-claim.js';
import { registerRequestPhotoUpload } from './tools/request-photo-upload.js';
import { EvidenceStore } from './evidence-store.js';
import { checkSafety } from './safety.js';

export function buildHttpServer(config: SvalinnConfig, options: { evidencePath?: string; photoPortalUrl?: string; customerId?: string } = {}) {
  const client = new SvalinnClient(config); // Configuration only, no claim cache.
  const evidence = new EvidenceStore(options.evidencePath ?? ':memory:');
  const portalUrl = options.photoPortalUrl ?? 'http://localhost:3003/upload';
  const portal = new URL(portalUrl);
  if (!['http:', 'https:'].includes(portal.protocol) || portal.username || portal.password) { evidence.close(); throw new Error('Invalid photo portal URL.'); }
  const customerId = options.customerId ?? 'CUST_00234';
  const app = createServer(async (request, response) => {
    if (request.url?.split('?')[0] !== '/mcp') { response.writeHead(404).end(); return; }
    if (request.method !== 'POST') {
      response.writeHead(405, { Allow: 'POST', 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null }));
      return;
    }
    const server = new McpServer({ name: 'claim-companion', version: '0.6.0' });
    registerReportIncident(server, client, customerId);
    registerReviewEvidence(server, client);
    registerGetClaimStatus(server, client);
    registerConfirmAndSubmit(server, client, evidence, customerId, config.tenantId, portalUrl);
    registerRequestPhotoUpload(server, client, evidence, config.tenantId, portalUrl);
    const address = app.address();
    const port = address && typeof address === 'object' ? address.port : 3002;
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true,
      enableDnsRebindingProtection: true, allowedHosts: [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`],
      allowedOrigins: ['http://localhost:6274', 'http://127.0.0.1:6274'] });
    response.on('close', () => { void server.close().catch(() => {}); });
    try {
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of request) {
        const buffer = Buffer.from(chunk);
        bytes += buffer.length;
        if (bytes > 1024 * 1024) { response.writeHead(413).end(); return; }
        chunks.push(buffer);
      }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch {
        response.writeHead(400, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'Invalid JSON.' }, id: null }));
        return;
      }
      // Injury/danger must win over unrelated tool argument validation errors.
      // Pass a valid emergency-only argument set through the normal SDK transport.
      if (body?.method === 'tools/call' && body.params?.name === 'report_incident') {
        const args = body.params.arguments;
        if (args && typeof args === 'object' && checkSafety(typeof args.narrative === 'string' ? args.narrative : undefined, args.anyone_injured === true).level === 'emergency') {
          body.params.arguments = { ...(typeof args.narrative === 'string' ? { narrative: args.narrative } : {}), anyone_injured: true };
          delete body.params._meta;
        }
      }
      await server.connect(transport);
      await transport.handleRequest(request, response, body);
    } catch {
      if (!response.headersSent) { response.writeHead(500, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error.' }, id: null })); }
      else response.end();
    }
  });
  app.once('close', () => evidence.close());
  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = buildHttpServer({ baseUrl: process.env.SVALINN_API_BASE_URL ?? '', apiKey: process.env.SVALINN_API_KEY ?? '', tenantId: process.env.SVALINN_TENANT_ID ?? '' },
    { evidencePath: process.env.EVIDENCE_DB_PATH ?? '.local/evidence.sqlite', photoPortalUrl: process.env.PHOTO_PORTAL_BASE_URL,
      customerId: process.env.LINKED_CUSTOMER_ID });
  const host = process.env.HOST ?? '127.0.0.1';
  const port = Number(process.env.PORT ?? 3002);
  app.listen(port, host, () => {
    const address = app.address();
    console.info(`Claim Companion MCP listening at http://${host}:${address && typeof address === 'object' ? address.port : port}/mcp`);
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => app.close(() => process.exit(0)));
}
