import { createServer } from 'node:http';
import { z } from 'zod';
import { McpBridge } from './bridge.js';
import { BedrockPlanner, DemoPlanner } from './model.js';
import { Orchestrator } from './orchestrator.js';

export function buildApi() {
  const mode = process.env.ORCHESTRATOR_MODE === 'demo' ? 'demo' : 'bedrock';
  const configured = mode === 'demo' || !!process.env.BEDROCK_ORCHESTRATOR_MODEL_ID;
  const orchestrator = new Orchestrator(new McpBridge(process.env.MCP_SERVER_URL ?? 'http://127.0.0.1:3002/mcp'),
    mode === 'demo' ? new DemoPlanner() : new BedrockPlanner(process.env.BEDROCK_ORCHESTRATOR_MODEL_ID ?? '', process.env.AWS_REGION ?? 'us-east-1'), mode);
  return createServer(async (request, response) => {
    const send = (status: number, data: unknown) => { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(data)); };
    if (request.headers.origin && !['http://127.0.0.1:5173', 'http://localhost:5173'].includes(request.headers.origin)) { send(403, { error: 'This demo accepts local browser requests only.' }); return; }
    if (request.method === 'GET' && request.url === '/api/config') { send(200, { mode, configured }); return; }
    if (request.method === 'GET' && request.url?.startsWith('/api/view?')) {
      try { const uri = new URL(request.url, 'http://localhost').searchParams.get('uri') ?? ''; send(200, { html: await new McpBridge(process.env.MCP_SERVER_URL ?? 'http://127.0.0.1:3002/mcp').view(uri) }); }
      catch { send(503, { error: 'The claim view is unavailable. The conversation still works.' }); }
      return;
    }
    if (request.method !== 'POST' || !['/api/turn', '/api/session'].includes(request.url ?? '')) { send(404, { error: 'Not found.' }); return; }
    try {
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of request) { const buffer = Buffer.from(chunk); size += buffer.length; if (size > 65536) { send(413, { error: 'Conversation is too long. Start a new conversation.' }); return; } chunks.push(buffer); }
      const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (request.url === '/api/session') {
        const data = z.object({ claimId: z.string().max(120).optional() }).strict().parse(input);
        send(200, { continuation: orchestrator.open(data.claimId) }); return;
      }
      const data = z.object({ message: z.string().trim().min(1).max(3000), messageId: z.string().uuid(), continuation: z.string().max(4000).optional(),
        history: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(3000) })).max(40) }).strict().parse(input);
      const result = await orchestrator.turn(data.message, data.history, data.messageId, data.continuation);
      send(200, result);
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      send(error instanceof z.ZodError || error instanceof SyntaxError ? 400 : 503, { error: code === 'SESSION_EXPIRED' ? 'This conversation has expired. Start a new conversation to continue.' : code === 'BEDROCK_NOT_CONFIGURED' ? 'The model is not configured. Use local demo mode or configure Bedrock on the server.' : 'I could not complete that turn. Retry the same message or check that the MCP service is running.' });
    }
  });
}
