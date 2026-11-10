'use client';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { money, type Lender } from '@/lib/types';

const num = (v: FormDataEntryValue | null) => Math.max(0, Math.round(Number(String(v ?? '').replace(/[$,\s]/g, '')) || 0));
const dec = (v: FormDataEntryValue | null) => { const s = String(v ?? '').trim(); return s === '' || isNaN(Number(s)) ? null : Number(s); };

export default function Lenders() {
  const [lenders, setLenders] = useState<Lender[] | null>(null);
  const [err, setErr] = useState('');
  const [edit, setEdit] = useState<Lender | 'new' | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('lenders').select('*').order('name');
    if (error) setErr(error.message); else setLenders(data as Lender[]);
  }, []);
  useEffect(() => { load(); }, [load]);

  if (err && !lenders) return <div className="err">Couldn&apos;t load lenders: {err}</div>;
  if (!lenders) return <span className="note">Loading…</span>;

  return (
    <>
      <div className="head">
        <div><h1>Lenders</h1><p>{lenders.length} lenders · these numbers drive the fit score on every deal</p></div>
        <button className="btn solid" onClick={() => setEdit('new')}>Add lender</button>
      </div>
      {lenders.length === 0 ? <div className="card note">No lenders yet. Add your first one — each lender&apos;s minimums become the rules deals are matched against.</div> :
      <div className="tablewrap"><table>
        <thead><tr><th>Lender</th><th>Paper</th><th>Min revenue</th><th>Min time</th><th>Min FICO</th><th>Max pos</th><th>Range</th><th>Factor</th><th>Comm.</th><th>Excluded</th></tr></thead>
        <tbody>{lenders.map(l => (
          <tr key={l.id} onClick={() => setEdit(l)} style={{ opacity: l.active ? 1 : .45 }}>
            <td><b>{l.name}</b>{!l.active && ' (paused)'}<small>{l.notes}</small></td>
            <td>{l.paper}</td><td>{money(l.min_revenue)}</td><td>{l.min_tib_months} mo</td><td>{l.min_fico}</td><td>{l.max_positions}</td>
            <td>{money(l.min_amount)}–{l.max_amount ? money(l.max_amount) : 'no cap'}</td>
            <td>{l.factor_low ? `${l.factor_low}–${l.factor_high}` : '—'}</td>
            <td>{l.commission_pct != null ? l.commission_pct + '%' : '—'}</td>
            <td>{l.excluded_industries.join(', ') || '—'}</td>
          </tr>))}</tbody>
      </table></div>}
      {edit && <LenderForm lender={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
    </>
  );
}

function LenderForm({ lender: l, onClose, onSaved }: { lender?: Lender; onClose: () => void; onSaved: () => void }) {
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const save = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setBusy(true); setErr('');
    const f = new FormData(e.currentTarget);
    const row = {
      name: String(f.get('name')).trim(), paper: String(f.get('paper')), min_revenue: num(f.get('min_revenue')),
      min_tib_months: num(f.get('min_tib_months')), min_fico: num(f.get('min_fico')), max_positions: num(f.get('max_positions')),
      min_amount: num(f.get('min_amount')), max_amount: num(f.get('max_amount')), factor_low: dec(f.get('factor_low')), factor_high: dec(f.get('factor_high')),
      commission_pct: dec(f.get('commission_pct')), speed: String(f.get('speed') ?? '').trim() || null,
      excluded_industries: String(f.get('excluded') ?? '').split(',').map(s => s.trim()).filter(Boolean),
      notes: String(f.get('notes') ?? '').trim() || null, active: f.get('active') === 'on',
    };
    const { error } = l ? await supabase.from('lenders').update(row).eq('id', l.id) : await supabase.from('lenders').insert(row);
    setBusy(false);
    if (error) setErr(error.message); else onSaved();
  };
  const remove = async () => {
    if (!l || !window.confirm(`Delete ${l.name}? Its submission history is deleted too.`)) return;
    const { error } = await supabase.from('lenders').delete().eq('id', l.id);
    if (error) setErr(error.message); else onSaved();
  };
  return (
    <div className="modal-bg" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="modal" onSubmit={save}>
        <h2>{l ? 'Edit lender' : 'Add lender'}</h2>
        <div className="form">
          <div><label>Lender name</label><input name="name" required defaultValue={l?.name} /></div>
          <div><label>Paper</label><select name="paper" defaultValue={l?.paper ?? 'B'}>{['A', 'A/B', 'B', 'B/C', 'C'].map(p => <option key={p}>{p}</option>)}</select></div>
          <div><label>Min monthly revenue ($)</label><input name="min_revenue" inputMode="numeric" required defaultValue={l?.min_revenue} /></div>
          <div><label>Min months in business</label><input name="min_tib_months" inputMode="numeric" required defaultValue={l?.min_tib_months} /></div>
          <div><label>Min FICO</label><input name="min_fico" inputMode="numeric" required defaultValue={l?.min_fico} /></div>
          <div><label>Max open positions</label><input name="max_positions" inputMode="numeric" required defaultValue={l?.max_positions} /></div>
          <div><label>Min advance ($)</label><input name="min_amount" inputMode="numeric" defaultValue={l?.min_amount ?? 0} /></div>
          <div><label>Max advance ($, 0 = no cap)</label><input name="max_amount" inputMode="numeric" defaultValue={l?.max_amount ?? 0} /></div>
          <div><label>Factor from</label><input name="factor_low" inputMode="decimal" placeholder="1.25" defaultValue={l?.factor_low ?? ''} /></div>
          <div><label>Factor to</label><input name="factor_high" inputMode="decimal" placeholder="1.45" defaultValue={l?.factor_high ?? ''} /></div>
          <div><label>Commission %</label><input name="commission_pct" inputMode="decimal" defaultValue={l?.commission_pct ?? ''} /></div>
          <div><label>Speed</label><input name="speed" placeholder="Same day" defaultValue={l?.speed ?? ''} /></div>
          <div className="full"><label>Excluded industries (comma separated)</label><input name="excluded" placeholder="Cannabis, Trucking" defaultValue={l?.excluded_industries.join(', ')} /></div>
          <div className="full"><label>Notes</label><textarea name="notes" rows={2} defaultValue={l?.notes ?? ''} /></div>
          <label className="full" style={{ display: 'flex', gap: 9, alignItems: 'center', margin: 0 }}>
            <input type="checkbox" name="active" defaultChecked={l?.active ?? true} style={{ width: 'auto' }} /> Active — include in matching</label>
        </div>
        {err && <div className="err">{err}</div>}
        <div className="acts">
          {l && <button type="button" className="btn danger" style={{ marginRight: 'auto' }} onClick={remove}>Delete</button>}
          <button type="button" className="btn flat" onClick={onClose}>Cancel</button>
          <button className="btn solid" disabled={busy}>{busy ? 'Saving…' : 'Save lender'}</button>
        </div>
      </form>
    </div>
  );
}
