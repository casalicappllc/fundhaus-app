'use client';
import { useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Deal, DealDocument, Submission } from '@/lib/types';
import type { Match } from '@/lib/matching';
import { draftEmail, recipients } from '@/lib/submit';

const mb = (b: number) => (b / 1048576).toFixed(1) + ' MB';
const day = (s: string) => new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/** Review screen: pick lenders and files, check the email, then send. Nothing goes out until "Send" is clicked. */
export default function SendToLenders({ deal, matches, subs, docs, activePositions, onClose, onSent }: {
  deal: Deal; matches: Match[]; subs: Submission[]; docs: DealDocument[]; activePositions: number;
  onClose: () => void; onSent: () => void;
}) {
  const sentTo = (lid: string) => subs.find(s => s.lender_id === lid && s.sent_at);
  const draft = useMemo(() => draftEmail(deal, activePositions), [deal, activePositions]);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(
    matches.filter(m => m.pass && recipients(m.lender).to && !sentTo(m.lender.id)).map(m => m.lender.id)));
  const [files, setFiles] = useState<Set<string>>(() => new Set(docs.filter(d => d.kind === 'application' || d.kind === 'bank_statement').map(d => d.id)));
  const [subject, setSubject] = useState(draft.subject);
  const [text, setText] = useState(draft.text);
  const [showAll, setShowAll] = useState(false);
  const [anyway, setAnyway] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [results, setResults] = useState<{ lender: string; ok: boolean; error?: string }[] | null>(null);

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, id: string) => {
    const n = new Set(set); if (n.has(id)) n.delete(id); else n.add(id); setter(n);
  };
  const chosenDocs = docs.filter(d => files.has(d.id));
  const bytes = chosenDocs.reduce((n, d) => n + Number(d.size_bytes || 0), 0);
  const hasApp = chosenDocs.some(d => d.kind === 'application'), hasStmt = chosenDocs.some(d => d.kind === 'bank_statement');
  const hit = deal.datamerch_status === 'hit';
  const unchecked = deal.datamerch_status !== 'clear' && !hit;
  const list = showAll ? matches : matches.filter(m => m.pass || picked.has(m.lender.id));
  const hidden = matches.length - list.length;
  const ready = picked.size > 0 && hasApp && hasStmt && bytes <= 18 * 1048576 && subject.trim() && text.trim() && (!hit || anyway);

  const send = async () => {
    setBusy(true); setErr('');
    const { data } = await supabase.auth.getSession();
    try {
      const r = await fetch(`/api/deals/${deal.id}/submit`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${data.session?.access_token ?? ''}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ lender_ids: [...picked], subject, text, doc_ids: [...files] }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) setErr(j?.error ?? `Sending stopped (${r.status}).`); else { setResults(j.results); onSent(); }
    } catch { setErr('Lost the connection while sending. Check the deal before trying again — some emails may have gone out.'); }
    setBusy(false);
  };

  if (results) return (
    <div className="modal-bg"><div className="modal">
      <h2>Sent</h2>
      {results.map(r => (
        <div key={r.lender} className={`send-res ${r.ok ? 'ok' : 'no'}`}>{r.ok ? '✓' : '✕'} <b>{r.lender}</b>{r.error && <span> — {r.error}</span>}</div>
      ))}
      <div className="acts"><button className="btn solid" onClick={onClose}>Done</button></div>
    </div></div>
  );

  return (
    <div className="modal-bg" onClick={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="modal wide">
        <h2>Send to lenders</h2>
        {hit && <div className="send-warn bad">
          <b>This merchant is on DataMerch.</b> Most lenders will decline and some will flag the submission.
          <label className="chk"><input type="checkbox" checked={anyway} onChange={e => setAnyway(e.target.checked)} /> Send anyway</label>
        </div>}
        {unchecked && <div className="send-warn">DataMerch hasn&apos;t cleared this deal yet{deal.ein ? '' : ' (no EIN on the deal)'}. You can still send.</div>}

        <h4>Lenders · {picked.size} picked</h4>
        <div className="send-list">
          {list.map(m => {
            const { to, cc } = recipients(m.lender); const s = sentTo(m.lender.id);
            return (
              <label key={m.lender.id} className={`send-l${!to ? ' off' : ''}`}>
                <input type="checkbox" disabled={!to} checked={picked.has(m.lender.id)} onChange={() => toggle(picked, setPicked, m.lender.id)} />
                <div>
                  <b>{m.lender.name}</b> <span className={`tag ${m.pass ? 'a' : 'c'}`}>{m.score}% fit</span>
                  {s && <span className="tag b">Sent {day(s.sent_at!)}</span>}
                  <small>{to ? [to, ...cc.map(c => 'cc ' + c)].join(' · ') : 'No submission email — add one on the Lenders page'}</small>
                </div>
              </label>
            );
          })}
          {list.length === 0 && <p className="note">No lender fits this deal yet.</p>}
        </div>
        {hidden > 0 && <button className="btn sm flat" style={{ marginTop: 8 }} onClick={() => setShowAll(true)}>Show {hidden} lender{hidden > 1 ? 's' : ''} that don&apos;t fit</button>}

        <h4>Attachments · {chosenDocs.length} file{chosenDocs.length === 1 ? '' : 's'}, {mb(bytes)}</h4>
        <div className="send-list">
          {docs.map(d => (
            <label key={d.id} className="send-l">
              <input type="checkbox" checked={files.has(d.id)} onChange={() => toggle(files, setFiles, d.id)} />
              <div><b>{d.file_name}</b><small>{d.kind.replace('_', ' ')} · {mb(Number(d.size_bytes || 0))}</small></div>
            </label>
          ))}
        </div>
        {(!hasApp || !hasStmt) && <p className="err">Attach the application and at least one bank statement.</p>}
        {bytes > 18 * 1048576 && <p className="err">Over 18 MB — untick some files so the email gets through.</p>}

        <h4>Email</h4>
        <div className="form" style={{ gridTemplateColumns: '1fr' }}>
          <div><label>Subject</label><input value={subject} onChange={e => setSubject(e.target.value)} /></div>
          <div><label>Message</label><textarea rows={11} value={text} onChange={e => setText(e.target.value)} /></div>
        </div>
        <p className="note" style={{ fontSize: 12, marginTop: 6 }}>Each lender gets its own email, so they don&apos;t see each other. Type {'{lender}'} anywhere to put in the lender&apos;s name.</p>

        {err && <div className="err">{err}</div>}
        <div className="acts">
          <button className="btn flat" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn solid" disabled={!ready || busy} onClick={send}>
            {busy ? 'Sending…' : `Send to ${picked.size} lender${picked.size === 1 ? '' : 's'}`}</button>
        </div>
      </div>
    </div>
  );
}
