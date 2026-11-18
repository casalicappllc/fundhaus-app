'use client';
import { useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { INDUSTRIES, type Deal } from '@/lib/types';
import { PLACEHOLDER_NAME } from '@/lib/autofill';
import { uploadDealFiles, DOC_ACCEPT } from '@/components/Documents';

const num = (v: FormDataEntryValue | null) => Math.max(0, Math.round(Number(String(v ?? '').replace(/[$,\s]/g, '')) || 0));
const txt = (v: FormDataEntryValue | null) => String(v ?? '').trim() || null;

export default function DealForm({ deal, onClose, onSaved }: { deal?: Deal; onClose: () => void; onSaved: (id: string) => void }) {
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'docs' | 'type'>(deal ? 'type' : 'docs');
  const save = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setBusy(true); setErr('');
    const f = new FormData(e.currentTarget);
    const row = {
      business: String(f.get('business')).trim(), owner_name: txt(f.get('owner_name')), phone: txt(f.get('phone')), email: txt(f.get('email')),
      city: txt(f.get('city')), industry: String(f.get('industry')), monthly_revenue: num(f.get('monthly_revenue')),
      tib_months: num(f.get('tib_months')), fico: num(f.get('fico')), positions: num(f.get('positions')), nsf_90d: num(f.get('nsf_90d')),
      amount_requested: num(f.get('amount_requested')), use_of_funds: txt(f.get('use_of_funds')), notes: txt(f.get('notes')),
    };
    const q = deal ? supabase.from('deals').update(row).eq('id', deal.id).select('id').single()
                   : supabase.from('deals').insert(row).select('id').single();
    const { data, error } = await q;
    setBusy(false);
    if (error) { setErr(error.message); return; }
    onSaved(data.id);
  };
  const d = deal;
  return (
    <div className="modal-bg" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <h2>{d ? 'Edit deal' : 'New deal'}</h2>
        {!d && (
          <div className="seg" role="tablist">
            <button type="button" role="tab" aria-selected={mode === 'docs'} className={mode === 'docs' ? 'on' : ''} onClick={() => setMode('docs')}>From documents</button>
            <button type="button" role="tab" aria-selected={mode === 'type'} className={mode === 'type' ? 'on' : ''} onClick={() => setMode('type')}>Type it in</button>
          </div>
        )}
        {mode === 'docs' ? <FromDocs onClose={onClose} onSaved={onSaved} /> : (
      <form onSubmit={save}>
        <div className="form">
          <div className="full"><label>Business name</label><input name="business" required defaultValue={d?.business} /></div>
          <div><label>Owner</label><input name="owner_name" defaultValue={d?.owner_name ?? ''} /></div>
          <div><label>City, state</label><input name="city" defaultValue={d?.city ?? ''} /></div>
          <div><label>Phone</label><input name="phone" defaultValue={d?.phone ?? ''} /></div>
          <div><label>Email</label><input name="email" type="email" defaultValue={d?.email ?? ''} /></div>
          <div><label>Monthly revenue ($)</label><input name="monthly_revenue" inputMode="numeric" required defaultValue={d?.monthly_revenue} /></div>
          <div><label>Amount requested ($)</label><input name="amount_requested" inputMode="numeric" required defaultValue={d?.amount_requested} /></div>
          <div><label>Months in business</label><input name="tib_months" inputMode="numeric" required defaultValue={d?.tib_months} /></div>
          <div><label>Owner FICO</label><input name="fico" inputMode="numeric" required defaultValue={d?.fico} /></div>
          <div><label>Open positions</label><input name="positions" inputMode="numeric" defaultValue={d?.positions ?? 0} /></div>
          <div><label>NSFs, last 90 days</label><input name="nsf_90d" inputMode="numeric" defaultValue={d?.nsf_90d ?? 0} /></div>
          <div><label>Industry</label><select name="industry" defaultValue={d?.industry ?? 'Other'}>{INDUSTRIES.map(i => <option key={i}>{i}</option>)}</select></div>
          <div><label>Use of funds</label><input name="use_of_funds" defaultValue={d?.use_of_funds ?? ''} /></div>
          <div className="full"><label>Notes</label><textarea name="notes" rows={2} defaultValue={d?.notes ?? ''} /></div>
        </div>
        {err && <div className="err">{err}</div>}
        <div className="acts">
          <button type="button" className="btn flat" onClick={onClose}>Cancel</button>
          <button className="btn solid" disabled={busy}>{busy ? 'Saving…' : 'Save deal'}</button>
        </div>
      </form>
        )}
      </div>
    </div>
  );
}

/** New deal from the application + bank statements: creates the deal, uploads the files,
 *  and opens the deal page, where the documents are read and the deal fills itself in. */
function FromDocs({ onClose, onSaved }: { onClose: () => void; onSaved: (id: string) => void }) {
  const [app, setApp] = useState<File[]>([]);
  const [stmts, setStmts] = useState<File[]>([]);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [made, setMade] = useState<string | null>(null);

  const create = async () => {
    setErr(''); setBusy('Creating deal…');
    const { data, error } = await supabase.from('deals').insert({ business: PLACEHOLDER_NAME }).select('id').single();
    if (error) { setBusy(''); setErr(error.message); return; }
    const id = data.id as string;
    const n = app.length + stmts.length;
    const p1 = await uploadDealFiles(id, app, 'application', i => setBusy(`Uploading ${i} of ${n}…`));
    const p2 = await uploadDealFiles(id, stmts, 'bank_statement', i => setBusy(`Uploading ${app.length + i} of ${n}…`));
    setBusy('');
    const problems = [...p1, ...p2];
    if (problems.length) { setMade(id); setErr(`Some files didn't upload: ${problems.join(' · ')}. Open the deal and add them under Documents.`); return; }
    onSaved(id);
  };

  return (
    <>
      <p className="note" style={{ marginBottom: 14 }}>Add the merchant&apos;s application and bank statements. The deal fills itself in — business details, monthly revenue, NSFs and current positions — and gets matched to your lenders.</p>
      <Picker label="Application" files={app} setFiles={setApp} />
      <Picker label="Bank statements" hint="last 3–4 months" files={stmts} setFiles={setStmts} />
      {err && <div className="err">{err}</div>}
      <div className="acts">
        <button type="button" className="btn flat" onClick={onClose}>Cancel</button>
        {made ? <button type="button" className="btn solid" onClick={() => onSaved(made)}>Open the deal</button>
          : <button type="button" className="btn solid" disabled={!!busy || !app.length || !stmts.length} onClick={create}>
            {busy || (!app.length ? 'Add the application' : !stmts.length ? 'Add bank statements' : 'Create deal')}</button>}
      </div>
    </>
  );
}

function Picker({ label, hint, files, setFiles }: { label: string; hint?: string; files: File[]; setFiles: (f: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const add = (list: File[]) => {
    const seen = new Set(files.map(f => f.name + f.size));
    setFiles([...files, ...list.filter(f => !seen.has(f.name + f.size))]);
    if (input.current) input.current.value = '';
  };
  return (
    <div className={`pick${over ? ' on' : ''}`}
      onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={e => { e.preventDefault(); setOver(false); add(Array.from(e.dataTransfer.files)); }}>
      <div className="pick-h">
        <div><b>{files.length ? '✓ ' : ''}{label}</b>{hint && <span> · {hint}</span>}</div>
        <button type="button" className="btn sm flat" onClick={() => input.current?.click()}>{files.length ? 'Add more' : 'Choose files'}</button>
        <input ref={input} type="file" multiple accept={DOC_ACCEPT} hidden onChange={e => add(Array.from(e.target.files ?? []))} />
      </div>
      {files.length === 0 ? <p className="note" style={{ fontSize: 12 }}>Or drag files here. PDF works best.</p>
        : files.map((f, i) => (
          <div className="pick-f" key={f.name + i}>
            <span>{f.name}</span>
            <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
    </div>
  );
}
