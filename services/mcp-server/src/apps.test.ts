import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { buildHttpServer } from './server.js';
import { viewUris } from './apps.js';

test('Apps resources are bundled, isolated and discoverable without changing core tool schemas', async () => {
  const server = buildHttpServer({ baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'synthetic-apps', tenantId: 'TEN_001' });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const client = new Client({ name: 'apps-contract', version: '0.1.0' });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`)));
    assert.deepEqual((await client.listResources()).resources.map(resource => resource.uri), [...viewUris]);
    for (const uri of viewUris) {
      const resource = (await client.readResource({ uri })).contents[0]!;
      assert.equal(resource.mimeType, 'text/html;profile=mcp-app');
      assert.ok('text' in resource);
      assert.match(resource.text, /Content-Security-Policy/);
      assert.match(resource.text, /connect-src 'none'/);
      assert.ok(resource.text.includes(`data-view="${uri.split('/').pop()}"`));
      const openingScript = resource.text.slice(0, resource.text.indexOf('<script') + 30);
      assert.match(openingScript, /<script type="module">/);
      assert.equal(resource.text.split('<!doctype html>').length, 2, 'Bundling must not duplicate the HTML template through replacement-string interpolation');
      assert.doesNotMatch(openingScript, /<script[^>]+src=/);
    }
    const tools = (await client.listTools()).tools;
    assert.equal(tools.length, 5);
    for (const tool of tools) assert.ok(viewUris.includes((tool._meta?.ui as { resourceUri: typeof viewUris[number] }).resourceUri));
    const result = await client.callTool({ name: 'get_claim_status', arguments: {} });
    assert.equal((result.structuredContent as { status: string }).status, 'needs_input');
  } finally {
    await client.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
