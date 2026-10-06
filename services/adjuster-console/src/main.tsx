import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { defaultRequest, stages, operation, readClaim, write, type Claim, type Operation } from './client';
import './style.css';

function App() {
  const [reference, setReference] = useState(''); const [claim, setClaim] = useState<Claim>();
  const [text, setText] = useState(defaultRequest); const [stage, setStage] = useState('ACKNOWLEDGED');
  const [busy, setBusy] = useState(false); const lock = useRef(false);
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const retry = useRef<Operation | undefined>(undefined);
  async function load(id = reference.trim()) {
    if (lock.current || !id) return; lock.current = true; setBusy(true); setError(''); setNotice(''); retry.current = undefined;
    try { const data = await readClaim(id); setClaim(data); setReference(data.claimId); }
    catch (failure) { setClaim(undefined); setError(failure instanceof Error ? failure.message : 'Could not open the claim.'); }
    finally { lock.current = false; setBusy(false); }
  }
  async function act(op: Operation) {
    if (lock.current) return; lock.current = true; setBusy(true); setError(''); setNotice(''); retry.current = op;
    try {
      await write(op); setClaim(await readClaim(op.claimId)); retry.current = undefined;
      setNotice(op.type === 'task' ? 'Information requested. The customer’s next claim-status check will read the oldest open request.' : 'Claim stage updated. Existing open tasks still determine the next move.');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not finish this action.'); }
    finally { lock.current = false; setBusy(false); }
  }
  return <main><header><div className="wordmark">SVALINN<span>ADJUSTER CONSOLE</span></div><span className="demo">FICTIONAL INSURER · DEMO</span></header><section className="intro"><p className="eyebrow">THE INSURER’S SIDE OF THE CONVERSATION</p><h1>A clear next step.</h1><p>Review a filed claim and tell the customer what you need next.</p></section>
    <form className="lookup" onSubmit={event => { event.preventDefault(); void load(); }}><label htmlFor="reference">Claim reference</label><div><input id="reference" value={reference} onChange={event => setReference(event.target.value)} placeholder="Paste the demo claim ID" disabled={busy} maxLength={120}/><button disabled={busy || !reference.trim()}>Open claim →</button></div></form>
    {error && <div className="error" role="alert">{error}{retry.current && <button onClick={() => retry.current && void act(retry.current)} disabled={busy}>Retry same action</button>}</div>}{notice && <div className="notice" role="status">{notice}</div>}
    {!claim ? <section className="empty"><span>○</span><h2>Start with a filed report.</h2><p>Copy its claim reference from Claim Companion, then open it here.</p><a href="http://127.0.0.1:5173" target="_blank" rel="noopener noreferrer">Open Claim Companion ↗</a></section> : <>
      <section className="claim-head"><div><p className="eyebrow">CLAIM</p><h2>{claim.claimNumber}</h2><code>{claim.claimId}</code></div><span className="stage">{claim.stage.replaceAll('_', ' ')}</span></section>
      <div className="grid"><div><section className="next"><p className="eyebrow">CURRENT NEXT STEP</p><h2>{claim.nextStepSummary}</h2><span>Next move: {claim.nextMove.toLowerCase()}</span><button className="text-button" disabled={busy} onClick={() => void load(claim.claimId)}>Refresh claim ↻</button></section>
        <section className="actions"><h2>Request more information</h2><p>Write one clear action for the customer. This becomes an open task in Svalinn.</p><label htmlFor="request">Customer request</label><textarea id="request" value={text} onChange={event => setText(event.target.value)} maxLength={240} disabled={busy} rows={3}/><button disabled={busy || !text.trim()} onClick={() => void act(operation(claim.claimId, 'task', { owner: 'CUSTOMER', text: text.trim() }))}>Request more info →</button></section>
        <section className="actions"><h2>Move the demo forward</h2><p>Stage changes leave open tasks in place. The oldest open task still controls the next step.</p><label htmlFor="stage">Next stage</label><select id="stage" value={stage} onChange={event => setStage(event.target.value)} disabled={busy}>{stages.map(item => <option key={item} value={item}>{item.replaceAll('_', ' ')}</option>)}</select><button className="secondary" disabled={busy} onClick={() => void act(operation(claim.claimId, 'stage', { stage }))}>Set stage</button></section></div>
        <aside><section><h2>Open tasks <small>{claim.openTasks.length}</small></h2>{claim.openTasks.length ? <ul>{claim.openTasks.map(task => <li key={task.taskId}><strong>{task.text}</strong><span>{task.owner.toLowerCase()} · {new Date(task.createdAt).toLocaleString()}</span></li>)}</ul> : <p>No open tasks.</p>}</section><section><h2>Evidence <small>{claim.evidence.length}</small></h2>{claim.evidence.length ? <ul>{claim.evidence.map(file => <li key={file.documentId}><strong>{file.label ?? file.kind}</strong><span>{new Date(file.uploadedAt).toLocaleString()}</span></li>)}</ul> : <p>No evidence received yet.</p>}</section><section><h2>Timeline</h2><ul>{[...claim.timeline].reverse().map((event, index) => <li key={index}><strong>{event.event.replaceAll('_', ' ').toLowerCase()}</strong><span>{new Date(event.at).toLocaleString()}</span></li>)}</ul></section></aside></div>
    </>}<footer>Original fictional insurer. All changes go to Svalinn; customer conversations read the same claim.</footer></main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
