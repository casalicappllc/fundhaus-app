'use client';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Deal, Lender, Submission } from '@/lib/types';
import { offerMath, parseNum, rateProblem, showRate, showTerm, type Offer } from '@/lib/offers';

const cents = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
const whole = (n: number) => '$' + Math.round(n).toLocaleString('en-US');
const day = (s: string) => new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/** Offers lenders came back with: lender, amount, buy rate, sell rate, term (daily or weekly payments). */
export default function Offers({ deal, lenders, subs, onChange }: { deal: Deal; lenders: Lender[]; subs: Submission[]; onChange: () => void }) {
  const [rows, setRows] = useState<Offer[]>([]);
  const [editing, setEditing] = useState<Offer | 'new' | null>(null);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('offers').select('*').eq('deal_id', deal.id).order('created_at');
    if (error) { setErr(/offers/.test(error.message) && /find|exist/i.test(error.message) ? 'Offers need a one-time database update (supabase/migration-2026-11-24-offers.sql).' : error.message); return; }
    setRows((data ?? []).map(o => ({ ...o, amount: Number(o.amount), buy_rate: o.buy_rate == null ? null : Number(o.buy_rate), sell_rate: o.sell_rate == null ? null : Number(o.sell_rate) })) as Offer[]);
  }, [deal.id]);
  useEffect(() => { load(); }, [load]);

  const save = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setErr('');
    const f = new FormData(e.currentTarget);
    const name = String(f.get('lender') ?? '').trim();
    const amount = parseNum(f.get('amount')), buy = parseNum(f.get('buy_rate')), sell = parseNum(f.get('sell_rate'));
    if (!name) { setErr('Add the lender.'); return; }
    if (!amount) { setErr('Add the offer amount.'); return; }
    const freq = f.get('term_freq') === 'weekly' ? 'weekly' as const : 'daily' as const;
    const countRaw = String(f.get('term_count') ?? '').trim();
    const count = countRaw ? Math.round(parseNum(countRaw) ?? 0) : null;
    if (count !== null && count < 1) { setErr('The term should be a number of payments, like 120.'); return; }
    const bad = rateProblem('Buy rate', buy) ?? rateProblem('Sell rate', sell)
      ?? (buy != null && sell != null && sell < buy ? 'The sell rate is lower than the buy rate.' : null);
    if (bad) { setErr(bad); return; }
    const lender = lenders.find(l => l.name.trim().toLowerCase() === name.toLowerCase());
    const row = {
      lender_id: lender?.id ?? null, lender_name: lender?.name ?? name, amount: Math.round(amount * 100) / 100,
      buy_rate: buy, sell_rate: sell, term_freq: freq, term_count: count, notes: String(f.get('notes') ?? '').trim() || null,
    };
    const isNew = editing === 'new';
    const { data: u } = await supabase.auth.getUser();
    const { error } = isNew
      ? await supabase.from('offers').insert({ ...row, deal_id: deal.id, created_by: u.user?.email ?? null })
      : await supabase.from('offers').update(row).eq('id', (editing as Offer).id);
    if (error) { setErr(error.message); return; }
    // A new offer also marks that lender's submission "Offer received" and moves the deal to Offers in.
    if (isNew) {
      const sub = lender && subs.find(s => s.lender_id === lender.id);
      if (sub && sub.status !== 'offer') await supabase.from('submissions').update({ status: 'offer' }).eq('id', sub.id);
      if (['new', 'prequal', 'submitted'].includes(deal.stage)) await supabase.from('deals').update({ stage: 'offers' }).eq('id', deal.id);
      onChange();
    }
    setEditing(null); await load();
  };

  const remove = async (o: Offer) => {
    if (!window.confirm(`Remove the ${o.lender_name} offer?`)) return;
    const { error } = await supabase.from('offers').delete().eq('id', o.id);
    if (error) setErr(error.message); else await load();
  };

  const cur = editing && editing !== 'new' ? editing : null;
  return (
    <div className="card">
      <h3>Offers{rows.length > 0 && ` — ${rows.length}`}</h3>
      {rows.length === 0 && !editing && <p className="note">No offers yet. When a lender comes back, add the amount, buy rate, sell rate and term (daily or weekly) here.</p>}
      {rows.length > 0 && (
        <div className="tablewrap">
          <table>
            <thead><tr><th>Lender</th><th>Amount</th><th>Buy rate</th><th>Sell rate</th><th>Term</th><th>Payback</th><th>Spread</th><th /></tr></thead>
            <tbody>
              {rows.map(o => {
                const m = offerMath(o);
                return (
                  <tr key={o.id}>
                    <td><b>{o.lender_name}</b><small>{day(o.created_at)}{o.notes ? ' · ' + o.notes : ''}</small></td>
                    <td><b>{whole(o.amount)}</b></td>
                    <td>{showRate(o.buy_rate)}</td>
                    <td>{showRate(o.sell_rate)}</td>
                    <td>{showTerm(o)}{m.payment != null && <small>{cents(m.payment)}{o.term_freq === 'weekly' ? '/wk' : '/day'}</small>}</td>
                    <td>{m.payback == null ? '—' : whole(m.payback)}</td>
                    <td>{m.spread == null ? '—' : <>{whole(m.spread)}<small>{m.points} pts</small></>}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn sm flat" onClick={() => { setErr(''); setEditing(o); }}>Edit</button>{' '}
                      <button className="btn sm flat" onClick={() => remove(o)} aria-label={`Remove the ${o.lender_name} offer`}>Remove</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {rows.some(o => o.buy_rate != null) && <p className="note" style={{ fontSize: 12, marginTop: 8 }}>Payback = amount × sell rate (buy rate if there&apos;s no sell rate yet). Spread = amount × (sell − buy). Payment = payback ÷ number of payments.</p>}
      {editing ? (
        <form className="pos-form" onSubmit={save} key={cur?.id ?? 'new'}>
          <div className="form">
            <div><label>Lender</label><input name="lender" list="offer-lenders" required defaultValue={cur?.lender_name ?? ''} placeholder="Pick or type a lender" autoComplete="off" />
              <datalist id="offer-lenders">{lenders.map(l => <option key={l.id} value={l.name} />)}</datalist></div>
            <div><label>Amount ($)</label><input name="amount" inputMode="decimal" required defaultValue={cur?.amount ?? ''} placeholder="e.g. 40,000" /></div>
            <div><label>Buy rate</label><input name="buy_rate" inputMode="decimal" defaultValue={cur?.buy_rate ?? ''} placeholder="e.g. 1.25" /></div>
            <div><label>Sell rate</label><input name="sell_rate" inputMode="decimal" defaultValue={cur?.sell_rate ?? ''} placeholder="e.g. 1.35" /></div>
            <div><label>Term</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input name="term_count" inputMode="numeric" defaultValue={cur?.term_count ?? ''} placeholder="# of payments, e.g. 120" style={{ flex: 1, minWidth: 0 }} />
                <select name="term_freq" defaultValue={cur?.term_freq ?? 'daily'} aria-label="Daily or weekly" style={{ width: 'auto' }}><option value="daily">Daily</option><option value="weekly">Weekly</option></select>
              </div></div>
            <div><label>Notes</label><input name="notes" defaultValue={cur?.notes ?? ''} placeholder="optional — stips, fees…" /></div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="btn solid">{cur ? 'Save offer' : 'Add offer'}</button>
            <button type="button" className="btn flat" onClick={() => { setEditing(null); setErr(''); }}>Cancel</button>
          </div>
        </form>
      ) : <button className="btn flat" style={{ marginTop: 12 }} onClick={() => { setErr(''); setEditing('new'); }}>+ Add offer</button>}
      {err && <div className="err">{err}</div>}
    </div>
  );
}
