'use client';
import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { INDUSTRIES, type Deal } from '@/lib/types';

const num = (v: FormDataEntryValue | null) => Math.max(0, Math.round(Number(String(v ?? '').replace(/[$,\s]/g, '')) || 0));
const txt = (v: FormDataEntryValue | null) => String(v ?? '').trim() || null;

export default function DealForm({ deal, onClose, onSaved }: { deal?: Deal; onClose: () => void; onSaved: (id: string) => void }) {
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
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
      <form className="modal" onSubmit={save}>
        <h2>{d ? 'Edit deal' : 'New deal'}</h2>
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
    </div>
  );
}
