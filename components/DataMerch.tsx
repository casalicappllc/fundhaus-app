'use client';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Deal } from '@/lib/types';
import { categories, normEin, showEin } from '@/lib/datamerch';

const stamp = (s: string) => new Date(s).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const day = (s: string | null) => s ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? s + 'T12:00:00' : s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';

async function runCheck(dealId: string): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return 'Sign in again and retry.';
  try {
    const r = await fetch(`/api/deals/${dealId}/datamerch`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    if (r.ok) return null;
    const j = await r.json().catch(() => null);
    return j?.error ?? `The DataMerch check stopped (${r.status}).`;
  } catch { return 'Lost the connection during the DataMerch check. Try again.'; }
}

/** Checks every deal against DataMerch by itself as soon as it has an EIN, and again if the EIN changes. */
export default function DataMerch({ deal, onDone }: { deal: Deal; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const tried = useRef<string | null>(null);
  const ein = normEin(deal.ein);
  const r = deal.datamerch_result;
  const stale = !!ein && (r?.ein ?? null) !== ein; // never checked, or checked under a different EIN
  const reading = deal.auto_status === 'running';

  const check = async () => {
    setBusy(true); setErr('');
    const e = await runCheck(deal.id);
    setBusy(false);
    if (e) setErr(e);
    onDone();
  };

  useEffect(() => {
    if (ein && stale && !busy && tried.current !== ein) { tried.current = ein; check(); }
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const status = deal.datamerch_status;
  const hits = status === 'hit' && r ? r.merchants : [];
  const cls = status === 'hit' ? ' dm-hit' : status === 'clear' && !stale ? ' dm-clear' : '';

  return (
    <div className={`card dm${cls}`}>
      <h3>DataMerch{ein && ` · EIN ${showEin(ein)}`}</h3>
      {busy ? <div className="reading"><span className="spin" aria-hidden /><b>Checking DataMerch…</b></div>
      : !ein ? <p className="note">{reading ? 'Waiting for the EIN from the application…' : <>No EIN on this deal yet, so it hasn&apos;t been checked. It&apos;s read from the application, or add it with <b>Edit</b>.</>}</p>
      : err ? <div className="err" style={{ marginTop: 0 }}>{err}</div>
      : status === 'error' && !stale ? <div className="err" style={{ marginTop: 0 }}>{r?.error ?? 'The DataMerch check failed.'}</div>
      : status === 'clear' && !stale ? <p className="dm-msg">✓ Nothing on DataMerch for this EIN.</p>
      : status === 'hit' && !stale ? <>
        <p className="dm-msg">✕ On DataMerch: {hits.length} record{hits.length === 1 ? '' : 's'}{categories(hits).length ? ` — ${categories(hits).join(', ')}` : ''}</p>
        {hits.map((m, i) => (
          <div className="dm-m" key={i}>
            <b>{[m.legal_name, m.dba && `DBA ${m.dba}`].filter(Boolean).join(' · ') || 'Unnamed business'}</b>
            <span>{[m.ein && `EIN ${showEin(normEin(m.ein) ?? m.ein)}`, [m.city, m.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}</span>
            {m.notes.map((n, j) => (
              <div className="dm-n" key={j}>
                {n.category && <span className="tag c">{n.category}</span>}
                <p>{n.note || 'No note'}</p>
                <small>{[n.added_by, day(n.created_at)].filter(Boolean).join(' · ')}</small>
              </div>
            ))}
          </div>
        ))}
      </> : null}
      {ein && !busy && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
          <button className="btn sm flat" onClick={check}>{err || status === 'error' ? 'Try again' : 'Check again'}</button>
          {deal.datamerch_checked_at && !stale && <span className="note" style={{ fontSize: 12 }}>Checked {stamp(deal.datamerch_checked_at)}{r?.checked_by ? ` by ${r.checked_by}` : ''}</span>}
        </div>
      )}
    </div>
  );
}
