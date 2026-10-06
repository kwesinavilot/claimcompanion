import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Card, Message, Trace, TurnResponse } from './types';
import { sampleReport } from './types';
import './style.css';

interface Recognition {
  lang: string; interimResults: boolean; continuous: boolean;
  onresult: ((event: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null; onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
}
const browser = window as typeof window & { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
const RecognitionClass = browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
const greeting: Message = { role: 'assistant', text: 'Tell me what happened. We will take this one step at a time.' };

function Icon({ kind }: { kind: 'mic' | 'send' | 'shield' | 'wave' }) {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === 'mic' ? <><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/></> : kind === 'send' ? <><path d="m3 4 18 8-18 8 4-8-4-8ZM7 12h14"/></> : kind === 'shield' ? <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/></> : <><path d="M3 9v6M7 5v14M12 2v20M17 6v12M21 10v4"/></>}
  </svg>;
}

function App() {
  const [messages, setMessages] = useState<Message[]>([greeting]);
  const [text, setText] = useState('');
  const [continuation, setContinuation] = useState<string>();
  const [stage, setStage] = useState<TurnResponse['stage']>('safety');
  const [card, setCard] = useState<Card>();
  const [traces, setTraces] = useState<Trace[]>([]);
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [voice, setVoice] = useState(true);
  const [error, setError] = useState('');
  const [mode, setMode] = useState('Connecting');
  const [existing, setExisting] = useState('');
  const busyRef = useRef(false);
  const micRef = useRef<Recognition | undefined>(undefined);
  const endRef = useRef<HTMLDivElement>(null);
  const lastRequest = useRef<{ message: string; messageId: string; history: Message[]; continuation?: string } | undefined>(undefined);
  useEffect(() => { fetch('/api/config').then(response => response.json()).then(config => setMode(config.mode === 'demo' ? 'Local demo · no model calls' : config.configured ? 'Bedrock orchestrator' : 'Bedrock · configuration needed')).catch(() => setMode('Connection unavailable')); }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [messages, busy]);
  useEffect(() => () => { micRef.current?.abort(); browser.speechSynthesis?.cancel(); }, []);
  const speak = (reply: string) => {
    if (!voice || !browser.speechSynthesis) return;
    browser.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(reply);
    utterance.lang = 'en-US'; utterance.rate = 0.94;
    browser.speechSynthesis.speak(utterance);
  };
  async function send(message: string, retry = false) {
    if (!message.trim() || busyRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    micRef.current?.stop(); browser.speechSynthesis?.cancel();
    const request = retry && lastRequest.current ? lastRequest.current : { message: message.trim(), messageId: crypto.randomUUID(), history: messages.slice(-30), continuation };
    lastRequest.current = request;
    if (!retry) { setMessages(current => [...current, { role: 'user', text: request.message }]); setText(''); }
    try {
      const response = await fetch('/api/turn', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'The connection was interrupted. Please retry.');
      const turn = data as TurnResponse;
      setContinuation(turn.continuation); setStage(turn.stage);
      setTraces(current => [...turn.traces, ...current].slice(0, 30));
      if (turn.card) setCard(current => ({ ...current, ...turn.card }));
      setMessages(current => [...current, { role: 'assistant', text: turn.text }]);
      speak(turn.text);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not complete that turn.'); }
    finally { busyRef.current = false; setBusy(false); }
  }
  function listen() {
    if (listening) { micRef.current?.stop(); return; }
    if (!RecognitionClass || busyRef.current) return;
    browser.speechSynthesis?.cancel(); setError('');
    const recognition = new RecognitionClass(); micRef.current = recognition;
    recognition.lang = 'en-US'; recognition.interimResults = false; recognition.continuous = false;
    let sent = false;
    recognition.onresult = event => {
      const result = Array.from(event.results).find(item => item.isFinal);
      if (result && !sent) { sent = true; void send(result[0].transcript); }
    };
    recognition.onerror = event => { if (event.error !== 'aborted') setError(event.error === 'not-allowed' ? 'Microphone access was denied. You can type your message below.' : 'Speech recognition could not finish. Please try again or type your message.'); };
    recognition.onend = () => setListening(false);
    try { recognition.start(); setListening(true); } catch { setError('The microphone could not start. Please type your message.'); }
  }
  async function reset(claimId?: string) {
    micRef.current?.abort(); browser.speechSynthesis?.cancel();
    setError('');
    try {
      const response = await fetch('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...(claimId ? { claimId } : {}) }) });
      if (!response.ok) throw new Error('Could not start a new conversation.');
      const data = await response.json();
      setContinuation(data.continuation); setMessages([{ role: 'assistant', text: claimId ? 'A new conversation, with your existing claim. Ask me how it is going.' : greeting.text }]);
      setStage(claimId ? 'submitted' : 'safety'); setCard(claimId ? { claimId } : undefined); setTraces([]); setText(''); lastRequest.current = undefined;
    } catch (failure) { setError(String(failure)); }
  }
  const progress = stage === 'submitted' ? 3 : stage === 'review' ? 2 : 1;
  const details = card?.details;
  return <div className="app">
    <header className="topbar"><a className="brand" href="/" aria-label="Claim Companion home"><span className="brand-mark"><Icon kind="wave"/></span><span>claim<span className="brand-light">companion</span></span></a><div className="top-right"><span className="demo-label">FICTIONAL INSURER DEMO</span><span className="avatar">JR</span></div></header>
    <main>
      <section className="intro"><div><p className="eyebrow">A LITTLE SUPPORT, WHEN IT MATTERS</p><h1>Take a breath.<br/>We’ll take it from here.</h1><p className="intro-copy">Tell us what happened, in your own words.<br/>Your companion will guide you through the next step.</p></div><div className="account"><span className="account-dot"/>Jordan Reyes<span className="account-sub">Svalinn · fictional demo account</span></div></section>
      <div className="workspace">
        <section className="companion" aria-label="Voice companion">
          <div className="companion-top"><div><span className="live-dot"/>YOUR CLAIM COMPANION</div><button className="text-button" onClick={() => void reset()} disabled={busy}>New conversation <span aria-hidden="true">↗</span></button></div>
          <div className="steps">{['Tell us what happened', 'Review together', 'Claim filed'].map((step, index) => <div className={progress >= index + 1 ? 'step active' : 'step'} key={step}><span>{progress > index + 1 ? '✓' : index + 1}</span>{step}</div>)}</div>
          {stage === 'emergency' && <div className="safety-banner" role="alert"><Icon kind="shield"/>Safety comes first. Pause your report and call your local emergency number if anyone is hurt or in danger.</div>}
          <div className="conversation" aria-live="polite" aria-relevant="additions" role="log" aria-label="Conversation transcript">{messages.map((message, index) => <div className={`message ${message.role}`} key={index}>{message.role === 'assistant' && <span className="message-icon"><Icon kind="wave"/></span>}<div><span className="speaker">{message.role === 'assistant' ? 'COMPANION' : 'YOU'}</span><p>{message.text}</p></div></div>)}{busy && <div className="thinking" role="status"><i/><i/><i/> Taking care of that…</div>}<div ref={endRef}/></div>
          {details && <div className="report-card" aria-label="Report details"><div className="report-title"><Icon kind="shield"/><strong>{stage === 'submitted' ? 'Your filed report' : 'Let’s make sure this is right'}</strong></div><dl><div><dt>When</dt><dd>{String(details.incidentAt ?? 'Still needed')}</dd></div><div><dt>Where</dt><dd>{String((details.incidentLocation as { description?: string })?.description ?? 'Still needed')}</dd></div><div><dt>Your vehicle</dt><dd>{String(details.vehicleRegistrationNumber ?? 'Still needed')}</dd></div></dl><p className="customer-description"><span>Your description</span>{String(details.narrative ?? '')}</p></div>}
          {stage === 'review' && <div className="quick-actions"><button onClick={() => void send('Yes, file it')} disabled={busy}>Yes, file it <span>→</span></button><button className="secondary" onClick={() => setText('Actually it was Elm Street, not Oak Street.')} disabled={busy}>Correct a detail</button></div>}
          {stage === 'submitted' && card?.claimId && <div className="filed-card"><span>✓</span><div><strong>Your claim is in.</strong><p>Reference for the demo <code>{card.claimId}</code></p>{card.uploadUrl && <p><a href={card.uploadUrl} target="_blank" rel="noopener noreferrer">Add your photos →</a></p>}</div><button className="text-button" onClick={() => void reset(card.claimId)} disabled={busy}>Check in later ↗</button></div>}
          <div className="input-area">{error && <div className="error" role="alert">{error} <button onClick={() => lastRequest.current && void send(lastRequest.current.message, true)} disabled={busy}>Retry same message</button></div>}<div className="voice-controls"><button className={`mic ${listening ? 'listening' : ''}`} onClick={listen} disabled={busy || !RecognitionClass} aria-label={listening ? 'Stop listening' : 'Start microphone'}><Icon kind="mic"/></button><div><strong>{listening ? 'Listening…' : 'You can talk, or type.'}</strong><span>{RecognitionClass ? 'Tap the microphone to start.' : 'Speech recognition is unavailable here. Use the text box.'}</span></div><label className="voice-toggle"><input type="checkbox" checked={voice} onChange={event => { setVoice(event.target.checked); if (!event.target.checked) browser.speechSynthesis?.cancel(); }}/><span>Read replies aloud</span></label></div><form onSubmit={event => { event.preventDefault(); void send(text); }}><input value={text} onChange={event => setText(event.target.value)} disabled={busy} maxLength={3000} aria-label="Your message" placeholder="Tell your companion what happened…"/><button type="submit" disabled={busy || !text.trim()} aria-label="Send message"><Icon kind="send"/></button></form><p className="privacy">Use fictional details only. Browser speech services may process microphone audio; Bedrock mode sends conversation text to AWS.</p></div>
        </section>
        <aside className="inspector" aria-label="MCP inspector"><div className="inspector-heading"><span className="code-icon">⌘</span><div><h2>Behind the conversation</h2><p>Real tools. Real claim state.</p></div></div><div className="mode"><span className="live-dot"/>{mode}</div><div className="inspector-body">{!traces.length ? <div className="trace-empty"><span>↔</span><h3>A clear view of every step.</h3><p>Tool calls appear here as your companion talks to Svalinn through MCP.</p><div className="connection"><span>COMPANION</span><i>↓</i><span>MCP TOOLS</span><i>↓</i><span>SVALINN API</span></div></div> : traces.map((trace, index) => <details className="trace" key={index} open={index === 0}><summary><span>{trace.name}</span><b className={trace.ms < 500 ? 'fast' : 'slow'}>{trace.ms} ms</b></summary><span className="trace-label">TOOLS/CALL · JSON-RPC</span><pre>{JSON.stringify({ name: trace.name, arguments: trace.arguments, result: trace.result }, null, 2)}</pre></details>)}</div><div className="demo-help"><h3>Try the local demo</h3><p>Start with the fictional parking-lot incident, then answer naturally or type your corrections.</p><button onClick={() => setText(sampleReport)} disabled={busy}>Use sample incident <span>→</span></button><label htmlFor="claim-reference">Continue an existing claim</label><div className="claim-input"><input id="claim-reference" value={existing} onChange={event => setExisting(event.target.value)} placeholder="Paste the demo claim ID"/><button disabled={busy || !existing.trim()} onClick={() => void reset(existing.trim())} aria-label="Open existing claim">↗</button></div></div></aside>
      </div>
      <footer><span><Icon kind="shield"/>Safety before paperwork. Every time.</span><span>Original fictional insurer · Amazon hackathon prototype</span></footer>
    </main>
  </div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
