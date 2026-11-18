'use client';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Deal } from '@/lib/types';
import { FREQUENCIES, FREQ_SHORT, POSITION_KINDS, burden, weekly, monthly, leverageBand } from '@/lib/positions';

export type Position = {
  id: string; deal_id: string; funder: string; kind: string; payment: number; frequency: string;
  funded_amount: number | null; funded_on: string | null; status: string; notes: string | null; created_at: string; detected?: boolean;
};

const cents = (n: number | null | undefined) => '$' + Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const whole = (n: number) => '$' + Math.round(n).toLocaleString('en-US');
const amt = (v: FormDataEntryValue | null) => { const n = Number(String(v ?? '').replace(/[$,\s]/g, '')); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null; };
const day = (s: string | null) => s ? new Date(s + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
export const LEV_CLASS: Record<string, string> = { light: 'good', moderate: 'mild', heavy: 'warn', 'very heavy': 'bad' };
export const LEV_TAG: Record<string, string> = { light: 'a', moderate: 'm', heavy: 'b', 'very heavy': 'c' };
const kindLabel = (k: string) => POSITION_KINDS.find(([v]) => v === k)?.[1] ?? 'Other';

export default function Positions({ deal, onCountChange, onLoaded }: { deal: Deal; onCountChange: () => void; onLoaded?: (rows: Position[]) => void }) {
  const [rows, setRows] = useState<Position[]>([]);
  const [editing, setEditing] = useState<Position | 'new' | null>(null);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('positions').select('*').eq('deal_id', deal.id).order('funded_on', { ascending: false, nullsFirst: false });
    if (error) { setErr(error.message); return []; }
    const list = (data ?? []).map(p => ({ ...p, payment: Number(p.payment), funded_amount: p.funded_amount == null ? null : Number(p.funded_amount) })) as Position[];
    setRows(list); onLoaded?.(list); return list;
  }, [deal.id, onLoaded]);
  useEffect(() => { load(); }, [load]);

  // Keep the deal's "open positions" number (used by lender matching) equal to the active positions listed here.
  const afterChange = async () => {
    const list = await load();
    const active = list.filter(p => p.status === 'active').length;
    if (active !== deal.positions) {
      const { error } = await supabase.from('deals').update({ positions: active }).eq('id', deal.id);
      if (error) setErr(error.message); else onCountChange();
    }
  };

  const save = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setErr('');
    const f = new FormData(e.currentTarget);
    const payment = amt(f.get('payment')) ?? 0; // 0 = funded but no debit seen yet
    const row = {
      funder: String(f.get('funder')).trim(), kind: String(f.get('kind')), payment, frequency: String(f.get('frequency')),
      funded_amount: amt(f.get('funded_amount')), funded_on: String(f.get('funded_on') || '') || null,
      status: String(f.get('status')), notes: String(f.get('notes') ?? '').trim() || null,
    };
    const q = editing === 'new' ? supabase.from('positions').insert({ ...row, deal_id: deal.id })
      : supabase.from('positions').update(row).eq('id', (editing as Position).id);
    const { error } = await q;
    if (error) { setErr(error.message); return; }
    setEditing(null); await afterChange();
  };

  const remove = async (p: Position) => {
    if (!window.confirm(`Remove ${p.funder} from this deal's positions?`)) return;
    const { error } = await supabase.from('positions').delete().eq('id', p.id);
    if (error) setErr(error.message); else await afterChange();
  };

  const b = burden(rows, deal.monthly_revenue);
  const unknown = rows.filter(p => p.status === 'active' && !(p.payment > 0)).length;
  const cur = editing && editing !== 'new' ? editing : null;
  return (
    <div className="card">
      <h3>Current positions{b.count > 0 && ` — ${b.count} active`}</h3>
      {b.count > 0 && (
        <div className="kv" style={{ gridTemplateColumns: 'repeat(3,1fr)', marginBottom: 14 }}>
          <div><span>Total weekly</span><b>{whole(b.perWeek)}</b></div>
          <div><span>Total monthly</span><b>{whole(b.perMonth)}</b></div>
          <div><span>Leverage</span><b className={LEV_CLASS[leverageBand(b.pct) ?? ''] ?? ''}>{b.pct == null ? 'Add revenue' : `${b.pct}% · ${leverageBand(b.pct)}`}</b></div>
        </div>
      )}
      {unknown > 0 && <p className="note" style={{ marginBottom: 10 }}>{unknown} position{unknown > 1 ? 's have' : ' has'} no payment yet, so the totals are low until {unknown > 1 ? 'they start' : 'it starts'} debiting.</p>}
      {rows.length === 0 && !editing && <p className="note">No positions listed. Add each MCA or loan the merchant is paying now, with its payment, and the totals are worked out for you.</p>}
      {rows.map(p => (
        <div className={`pos${p.status !== 'active' ? ' off' : ''}`} key={p.id}>
          <div className="pos-main">
            <b>{p.funder} <span className="tag">{kindLabel(p.kind)}</span>{p.detected && <span className="tag auto">From statements</span>}{p.status !== 'active' && <span className="tag a">Paid off</span>}</b>
            <span>{[p.funded_amount && 'funded ' + cents(p.funded_amount), p.funded_on && day(p.funded_on), p.notes].filter(Boolean).join(' · ')}</span>
          </div>
          <div className="pos-pay">
            {p.payment > 0 ? <>
              <b>{cents(p.payment)}{FREQ_SHORT[p.frequency] ?? ''}</b>
              {p.frequency !== 'weekly' && <span>≈ {whole(weekly(p))}/wk</span>}
              {p.frequency === 'weekly' && <span>≈ {whole(monthly(p))}/mo</span>}
            </> : <span className="warn-txt">Payment not seen yet</span>}
          </div>
          <div className="doc-acts">
            <button className="btn sm flat" onClick={() => setEditing(p)}>Edit</button>
            <button className="btn sm flat" onClick={() => remove(p)} aria-label={`Remove ${p.funder}`}>Remove</button>
          </div>
        </div>
      ))}
      {editing ? (
        <form className="pos-form" onSubmit={save} key={cur?.id ?? 'new'}>
          <div className="form">
            <div><label>Funder</label><input name="funder" required defaultValue={cur?.funder ?? ''} placeholder="e.g. Forward Financing" /></div>
            <div><label>Type</label><select name="kind" defaultValue={cur?.kind ?? 'mca'}>{POSITION_KINDS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></div>
            <div><label>Payment ($)</label><input name="payment" inputMode="decimal" defaultValue={cur?.payment || ''} placeholder="blank if no debit yet" /></div>
            <div><label>How often</label><select name="frequency" defaultValue={cur?.frequency ?? 'daily'}>{FREQUENCIES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></div>
            <div><label>Funded amount ($)</label><input name="funded_amount" inputMode="decimal" defaultValue={cur?.funded_amount ?? ''} /></div>
            <div><label>Funded on</label><input name="funded_on" type="date" defaultValue={cur?.funded_on ?? ''} /></div>
            <div><label>Status</label><select name="status" defaultValue={cur?.status ?? 'active'}><option value="active">Active</option><option value="paid_off">Paid off</option></select></div>
            <div><label>Notes</label><input name="notes" defaultValue={cur?.notes ?? ''} placeholder="optional" /></div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="btn solid">{cur ? 'Save position' : 'Add position'}</button>
            <button type="button" className="btn flat" onClick={() => { setEditing(null); setErr(''); }}>Cancel</button>
          </div>
        </form>
      ) : <button className="btn flat" style={{ marginTop: 12 }} onClick={() => setEditing('new')}>+ Add position</button>}
      {err && <div className="err">{err}</div>}
    </div>
  );
}
