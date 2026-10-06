import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { SvalinnClient, SvalinnError } from './svalinn-client.js';

test('upstream timeout and malformed replies become controlled tool-client errors', async () => {
  let mode = 'invalid';
  const app = createServer((_request, response) => {
    if (mode === 'invalid') response.writeHead(200, { 'Content-Type': 'application/json' }).end('{"status":"ok","requestId":"req_fixture","data":{}}');
    // Deliberately leave a response open to exercise the bounded timeout.
  });
  await new Promise<void>(resolve => app.listen(0, '127.0.0.1', resolve));
  const address = app.address();
  assert.ok(address && typeof address === 'object');
  const client = new SvalinnClient({ baseUrl: `http://127.0.0.1:${address.port}/v1`, apiKey: 'synthetic-client-key', tenantId: 'TEN_001' });
  try {
    await assert.rejects(() => client.getClaim('clm_fixture'), (error: unknown) => error instanceof SvalinnError && error.code === 'INVALID_UPSTREAM_RESPONSE');
    mode = 'timeout';
    await assert.rejects(() => client.getClaim('clm_fixture'), (error: unknown) => error instanceof SvalinnError && error.code === 'UPSTREAM_TIMEOUT');
  } finally {
    app.closeAllConnections();
    await new Promise<void>(resolve => app.close(() => resolve()));
  }
});
