import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

interface Job { photo_key: string; label: string; status: string; document_id?: string; error?: string; quality_result?: { usable: boolean; issues: string[] }; ocr_result?: { status: string }; damage_result?: { status: string } }
interface Session { expiresAt: string; used: boolean; checklist: string[]; mode: string; jobs: Job[] }
const shots = ['Scene wide', 'Your car — front', 'Your car — rear', 'Your car — left', 'Your car — right', 'Damage close-up', 'Other car plate'];

function App() {
  const [token] = useState(() => new URLSearchParams(location.search).get('token') ?? '');
  const [session, setSession] = useState<Session>();
  const [photos, setPhotos] = useState<{ file: File; preview: string; label: string }[]>([]);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const busyRef = useRef(false); const key = useRef(crypto.randomUUID());
  const previews = useRef<string[]>([]);
  useEffect(() => { history.replaceState(null, '', location.pathname); }, []);
  useEffect(() => () => previews.current.forEach(url => URL.revokeObjectURL(url)), []);
  async function load() {
    const response = await fetch('/api/session', { headers: { Authorization: `Bearer ${token}` } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? 'The upload link could not be opened.');
    setSession(data); return data as Session;
  }
  useEffect(() => {
    if (!token) { setError('Open the photo link from your companion to get started.'); return; }
    let alive = true;
    const refresh = () => { void load().catch(failure => { if (alive) setError(failure.message); }); };
    refresh(); const timer = setInterval(refresh, 2000);
    return () => { alive = false; clearInterval(timer); };
  }, [token]);
  function choose(files: FileList | null, append = false) {
    if (!files || busy || session?.used) return;
    const selected = Array.from(files);
    if (selected.length + (append ? photos.length : 0) > 8 || selected.some(file => file.size > 10 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))) {
      setError('Choose up to eight JPEG, PNG or WebP photos, each at most 10 MiB.'); return;
    }
    setError(''); key.current = crypto.randomUUID();
    if (!append) { previews.current.forEach(url => URL.revokeObjectURL(url)); previews.current = []; }
    const added = selected.map(file => { const preview = URL.createObjectURL(file); previews.current.push(preview); return { file, preview, label: 'Damage close-up' }; });
    setPhotos(append ? [...photos, ...added] : added);
  }
  async function upload() {
    if (busyRef.current || !photos.length || session?.used) return;
    busyRef.current = true; setBusy(true); setError('');
    const form = new FormData();
    photos.forEach(photo => form.append('photos', photo.file, photo.file.name));
    form.set('labels', JSON.stringify(photos.map(photo => photo.label)));
    try {
      const response = await fetch('/api/photos', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': key.current }, body: form });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      await load(); previews.current.forEach(url => URL.revokeObjectURL(url)); previews.current = []; setPhotos([]);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not send the photos. Retry this batch.'); }
    finally { busyRef.current = false; setBusy(false); }
  }
  const jobs = session?.jobs ?? [];
  const pending = jobs.some(job => job.status === 'pending');
  return <main><header><span className="mark">▥</span><strong>claim<span>companion</span></strong><small>FICTIONAL DEMO</small></header>
    <p className="eyebrow">THE NEXT STEP, AT YOUR PACE</p><h1>A clearer picture.<br/>A little less worry.</h1><p className="lead">Add photos to your report. We’ll check that they’re clear enough before passing them to Svalinn.</p>
    <section className="checklist"><h2>What to capture</h2><ul>{(session?.checklist ?? ['Scene wide', 'Your car from all four corners', 'Damage close-up', 'Other car plate']).map(shot => <li key={shot}><span>○</span>{shot}</li>)}</ul><p>Only take photos when you are somewhere safe.</p></section>
    {error && <p className="error" role="alert">{error}</p>}
    {session && !session.used && <section className="upload"><h2>Your photos</h2><p>Choose one batch of up to eight photos. This link expires at {new Date(session.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.</p><label className="choose">＋ Choose photos<input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={busy} onChange={event => choose(event.target.files)}/></label>
      <label className="camera">Take a photo<input aria-label="Take a photo" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" disabled={busy} onChange={event => choose(event.target.files, true)}/></label>
      <div className="previews">{photos.map((photo, index) => <article key={`${photo.file.name}:${index}`}><img src={photo.preview} alt={`Selected photo ${index + 1}`}/><label>What does this show?<select value={photo.label} disabled={busy} onChange={event => { key.current = crypto.randomUUID(); setPhotos(current => current.map((item, i) => i === index ? { ...item, label: event.target.value } : item)); }}>{shots.map(shot => <option key={shot}>{shot}</option>)}</select></label></article>)}</div>
      <button className="primary" disabled={busy || !photos.length} onClick={() => void upload()}>{busy ? 'Sending your photos…' : `Send ${photos.length || ''} photo${photos.length === 1 ? '' : 's'} →`}</button><p className="fine">JPEG, PNG or WebP · 10 MiB per photo. If sending is interrupted, try again with the same selection.</p></section>}
    {session?.used && <section className="results" aria-live="polite"><h2>{pending ? 'Checking your photos…' : 'Your photo update'}</h2><p>{pending ? 'You can leave this open while we check the detail and light.' : 'You can ask your companion which photos arrived.'}</p>{jobs.map(job => <article key={job.photo_key}><div className={`badge ${job.status}`}>{job.status === 'pending' ? '◌' : job.document_id ? '✓' : '↻'}</div><div><h3>{job.label}</h3><strong>{job.status === 'pending' ? 'Processing' : job.error === 'RETAKE_NEEDED' ? 'Please retake this photo' : job.document_id ? 'Received by Svalinn' : 'Could not finish processing'}</strong>{job.quality_result?.issues.map(issue => <p key={issue}>{issue}</p>)}{job.document_id && job.status === 'failed' && <p>The photo arrived; further analysis needs a human look.</p>}{job.status === 'done' && <p>Clarity check passed. {session.mode === 'local' ? 'Text and damage analysis are unavailable in local mode.' : 'Any extracted text needs confirmation; observations need human review.'}</p>}</div></article>)}<p className="next">For more photos or a retake, ask your companion for a new photo link.</p></section>}
    <footer>Use fictional photos only, without real plates or faces. {session?.mode === 'aws' ? 'AWS processes photos for text and damage observations.' : 'Local quality checks; no cloud image analysis.'}</footer>
  </main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
