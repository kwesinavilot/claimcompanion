import { registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { readFile } from 'node:fs/promises';
export const viewUris = ['ui://claims/intake-summary', 'ui://claims/evidence-checklist', 'ui://claims/status-timeline'] as const;
export function registerViews(server: McpServer) {
  for (const uri of viewUris) registerAppResource(server, uri.split('/').pop()!, uri, { mimeType: RESOURCE_MIME_TYPE, description: 'Claim Companion view with Svalinn facts.' }, async () => ({ contents: [{
    uri, mimeType: RESOURCE_MIME_TYPE,
    text: (await readFile(new URL('../apps/dist/view.html', import.meta.url), 'utf8')).replace('__CLAIM_VIEW__', uri.split('/').pop()!),
    _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] }, prefersBorder: true } },
  }] }));
}
