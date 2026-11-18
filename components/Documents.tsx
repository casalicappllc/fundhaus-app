'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { DOC_KINDS, DOCS_BUCKET, type DealDocument } from '@/lib/types';

const MAX_BYTES = 25 * 1024 * 1024;
// Extension -> content type. Phones often hand over HEIC photos with no type, so we go by extension.
const TYPES: Record<string, string> = {
  pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', heic: 'image/heic', heif: 'image/heif',
  webp: 'image/webp', csv: 'text/csv', xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
const ACCEPT = Object.keys(TYPES).map(e => '.' + e).join(',');
const size = (b: number) => b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
const when = (s: string) => new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/** Deletes every stored file for a deal. Call before deleting the deal itself. */
export async function removeDealFiles(dealId: string) {
  const { data, error } = await supabase.from('documents').select('storage_path').eq('deal_id', dealId);
  if (error) return error.message;
  const paths = (data ?? []).map(d => d.storage_path as string);
  if (!paths.length) return null;
  const r = await supabase.storage.from(DOCS_BUCKET).remove(paths);
  return r.error ? r.error.message : null;
}

/** Uploads files to a deal as one document type. Returns a list of problems (empty if all went in). */
export async function uploadDealFiles(dealId: string, files: File[], kind: string, progress?: (i: number, n: number) => void) {
  const { data: u } = await supabase.auth.getUser();
  const problems: string[] = [];
  for (const [i, file] of files.entries()) {
    const ext = (file.name.split('.').pop() ?? '').toLowerCase();
    const type = TYPES[ext];
    if (!type) { problems.push(`${file.name}: only PDF, photo or spreadsheet files`); continue; }
    if (file.size > MAX_BYTES) { problems.push(`${file.name}: over 25 MB`); continue; }
    progress?.(i + 1, files.length);
    const safe = file.name.replace(/[^\w.\-]+/g, '_').slice(-80);
    const path = `${dealId}/${crypto.randomUUID()}-${safe}`;
    const up = await supabase.storage.from(DOCS_BUCKET).upload(path, file, { contentType: type, upsert: false });
    if (up.error) { problems.push(`${file.name}: ${up.error.message}`); continue; }
    const row = await supabase.from('documents').insert({
      deal_id: dealId, kind, file_name: file.name, storage_path: path, size_bytes: file.size, uploaded_by: u.user?.email ?? null,
    });
    if (row.error) { await supabase.storage.from(DOCS_BUCKET).remove([path]); problems.push(`${file.name}: ${row.error.message}`); }
  }
  return problems;
}
export const DOC_ACCEPT = ACCEPT;

export default function Documents({ dealId, onChange }: { dealId: string; onChange?: (docs: DealDocument[]) => void }) {
  const [docs, setDocs] = useState<DealDocument[]>([]);
  const [kind, setKind] = useState('bank_statement');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('documents').select('*').eq('deal_id', dealId).order('created_at', { ascending: false });
    if (error) setErr(error.message); else { setDocs(data as DealDocument[]); onChange?.(data as DealDocument[]); }
  }, [dealId, onChange]);
  useEffect(() => { load(); }, [load]);

  const upload = async (files: File[]) => {
    if (!files.length) return;
    setErr('');
    const problems = await uploadDealFiles(dealId, files, kind, (i, n) => setBusy(`Uploading ${i} of ${n}…`));
    setBusy(''); if (input.current) input.current.value = '';
    if (problems.length) setErr(problems.join(' · '));
    await load();
  };

  // Links expire after 60 seconds, so a forwarded or leaked link stops working almost at once.
  const open = async (d: DealDocument, download: boolean) => {
    const tab = download ? null : window.open('', '_blank');
    const { data, error } = await supabase.storage.from(DOCS_BUCKET).createSignedUrl(d.storage_path, 60, download ? { download: d.file_name } : undefined);
    if (error || !data) { tab?.close(); setErr(error?.message ?? 'Could not open the file.'); return; }
    if (tab) tab.location.href = data.signedUrl; else window.location.href = data.signedUrl;
  };

  const setDocKind = async (d: DealDocument, k: string) => {
    const { error } = await supabase.from('documents').update({ kind: k }).eq('id', d.id);
    if (error) setErr(error.message); else load();
  };

  const remove = async (d: DealDocument) => {
    if (!window.confirm(`Delete ${d.file_name}? This can't be undone.`)) return;
    const s = await supabase.storage.from(DOCS_BUCKET).remove([d.storage_path]);
    if (s.error) { setErr(s.error.message); return; }
    const { error } = await supabase.from('documents').delete().eq('id', d.id);
    if (error) setErr(error.message); else load();
  };

  const statements = docs.filter(d => d.kind === 'bank_statement').length;
  return (
    <div className="card"
      onDragOver={e => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={e => { e.preventDefault(); setOver(false); upload(Array.from(e.dataTransfer.files)); }}>
      <h3>Documents{docs.length > 0 && ` — ${docs.length}`}{statements > 0 && ` · ${statements} bank statement${statements > 1 ? 's' : ''}`}</h3>
      <div className={`drop${over ? ' on' : ''}`}>
        <select value={kind} onChange={e => setKind(e.target.value)} aria-label="Document type">
          {DOC_KINDS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
        </select>
        <button className="btn solid" disabled={!!busy} onClick={() => input.current?.click()}>{busy || 'Upload files'}</button>
        <input ref={input} type="file" multiple accept={ACCEPT} hidden onChange={e => upload(Array.from(e.target.files ?? []))} />
        <p className="note">Or drag files here. PDF, photo or spreadsheet, up to 25 MB each. Only your team can open them.</p>
      </div>
      {err && <div className="err">{err}</div>}
      {docs.length === 0 && <p className="note" style={{ marginTop: 12 }}>No documents yet. Most lenders want the last 3–4 months of business bank statements.</p>}
      {docs.map(d => (
        <div className="doc" key={d.id}>
          <div className="doc-main">
            <button className="doc-name" onClick={() => open(d, false)} title="Open">{d.file_name}</button>
            <span>{size(d.size_bytes)} · {when(d.created_at)}{d.uploaded_by ? ' · ' + d.uploaded_by : ''}</span>
          </div>
          <select className="doc-kind" value={d.kind} onChange={e => setDocKind(d, e.target.value)} aria-label={`Type of ${d.file_name}`}>
            {DOC_KINDS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </select>
          <div className="doc-acts">
            <button className="btn sm flat" onClick={() => open(d, true)}>Download</button>
            <button className="btn sm flat" onClick={() => remove(d)} aria-label={`Delete ${d.file_name}`}>Delete</button>
          </div>
        </div>
      ))}
      {docs.length > 0 && <p className="note" style={{ marginTop: 10, fontSize: 12 }}>Bank statements and IDs hold account and personal details. Download them only to devices you trust.</p>}
    </div>
  );
}
