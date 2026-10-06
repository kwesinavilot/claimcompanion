import React, { useEffect, useRef, useState } from 'react';
import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge';
import type { Trace } from './types';

const allowedMessages = new Set(['Yes, file it', 'I need to correct a detail.', 'Send photos', 'Did my photos arrive?', 'How is my claim going?']);
export function McpApp({ trace, onMessage }: { trace: Trace; onMessage: (text: string) => Promise<void> }) {
  const iframe = useRef<HTMLIFrameElement>(null); const callback = useRef(onMessage); callback.current = onMessage;
  const [failure, setFailure] = useState(false); const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    let stopped = false; let bridge: AppBridge | undefined;
    setFailure(false); setExpanded(false);
    void (async () => {
      const response = await fetch(`/api/view?uri=${encodeURIComponent(trace.uiUri ?? '')}`);
      if (!response.ok) throw new Error('View unavailable');
      const { html } = await response.json();
      if (stopped || !iframe.current?.contentWindow) return;
      const element = iframe.current;
      bridge = new AppBridge(null, { name: 'Claim Companion simulator', version: '0.8.0' }, { openLinks: {} }, { hostContext: { displayMode: 'inline', availableDisplayModes: ['inline', 'fullscreen'] } });
      bridge.onmessage = async params => {
        if (stopped || params.role !== 'user' || params.content.length !== 1 || params.content[0].type !== 'text' || !allowedMessages.has(params.content[0].text)) return { isError: true };
        await callback.current(params.content[0].text); return {};
      };
      bridge.onopenlink = async ({ url }) => {
        const source = (trace.result.data as { upload_url?: string } | undefined)?.upload_url;
        if (stopped || url !== source || !['http:', 'https:'].includes(new URL(url).protocol)) return { isError: true };
        window.open(url, '_blank', 'noopener,noreferrer'); return {};
      };
      bridge.onrequestdisplaymode = async ({ mode }) => { if (!stopped) setExpanded(mode === 'fullscreen'); return { mode: mode === 'fullscreen' ? 'fullscreen' : 'inline' }; };
      bridge.onsizechange = ({ height }) => { if (!stopped && height) element.style.height = `${Math.min(Math.max(height, 220), 700)}px`; };
      bridge.oninitialized = () => { void (async () => {
        if (!stopped && bridge) { await bridge.sendToolInput({ arguments: trace.arguments }); await bridge.sendToolResult({ content: [{ type: 'text', text: String(trace.result.summary ?? '') }], structuredContent: trace.result }); }
      })().catch(() => { if (!stopped) setFailure(true); }); };
      await bridge.connect(new PostMessageTransport(element.contentWindow!, element.contentWindow!));
      if (!stopped) element.srcdoc = html;
    })().catch(() => { if (!stopped) setFailure(true); });
    return () => { stopped = true; if (bridge) void bridge.teardownResource({}).catch(() => {}).finally(() => bridge?.close()); };
  }, [trace]);
  if (failure) return <p className="mcp-app-fallback">The claim view is unavailable. You can continue by voice or text.</p>;
  return <section className={expanded ? 'mcp-app expanded' : 'mcp-app'} aria-label="MCP claim view">{expanded && <button className="close-view" onClick={() => setExpanded(false)}>Close expanded view</button>}<iframe ref={iframe} sandbox="allow-scripts" title="Interactive claim view" referrerPolicy="no-referrer"/></section>;
}
