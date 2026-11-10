'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { STAGES, money, type Deal, type Lender, type Submission } from '@/lib/types';
import { matchAll, paperGrade } from '@/lib/matching';
import DealForm from '@/components/DealForm';

export default function DealPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [deal, setDeal] = useState<Deal | null>(null);
  const [lenders, setLenders] = useState<Lender[]>([]);
  const [subs, setSubs] = useState<Submission[]>([]);
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    const [d, l, s] = await Promise.all([
      supabase.from('deals').select('*').eq('id', id).maybeSingle(),
      supabase.from('lenders').select('*'),
      supabase.from('submissions').select('*').eq('deal_id', id),
    ]);
    const e = d.error ?? l.error ?? s.error;
    if (e) { setErr(e.message); return; }
    if (!d.data) { setErr('This deal no longer exists.'); return; }
    setDeal(d.data as Deal); setLenders(l.data as Lender[]); setSubs(s.data as Submission[]);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const run = async (q: PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await q; if (error) setErr(error.message); else { setErr(''); await load(); }
  };
  if (!deal) return err ? <div className="err">{err} <Link href="/">Back to pipeline</Link></div> : <span className="note">Loading…</span>;

  const matches = matchAll(deal, lenders);
  const subFor = (lid: string) => subs.find(s => s.lender_id === lid);
  const setStage = (stage: string) => run(supabase.from('deals').update({ stage }).eq('id', deal.id));
  const submit = async (lid: string) => {
    await run(supabase.from('submissions').insert({ deal_id: deal.id, lender_id: lid }));
    if (['new', 'prequal'].includes(deal.stage)) await setStage('submitted');
  };
  const setStatus = (s: Submission, status: string) => run(supabase.from('submissions').update({ status }).eq('id', s.id));
  const saveFunding = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault(); const f = new FormData(e.currentTarget);
    const n = (k: string) => Math.max(0, Math.round(Number(String(f.get(k)).replace(/[$,\s]/g, '')) || 0));
    await run(supabase.from('deals').update({ funded_amount: n('funded_amount'), commission: n('commission'), stage: 'funded' }).eq('id', deal.id));
  };
  const remove = async () => {
    if (!window.confirm(`Delete ${deal.business}? This can't be undone.`)) return;
    const { error } = await supabase.from('deals').delete().eq('id', deal.id);
    if (error) setErr(error.message); else router.push('/');
  };
  const g = paperGrade(deal);

  return (
    <>
      <Link className="back" href="/">‹ Pipeline</Link>
      <div className="head">
        <div><h1>{deal.business}</h1><p>{[deal.city, deal.industry, 'requesting ' + money(deal.amount_requested)].filter(Boolean).join(' · ')}</p></div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select style={{ width: 'auto' }} value={deal.stage} onChange={e => setStage(e.target.value)}>
            {STAGES.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
          </select>
          <button className="btn flat" onClick={() => setEditing(true)}>Edit</button>
        </div>
      </div>
      {err && <div className="err" style={{ marginBottom: 12 }}>{err}</div>}
      <div className="grid2">
        <div>
          <div className="card">
            <h3>Underwriting snapshot</h3>
            <div className="kv">
              <div><span>Monthly revenue</span><b>{money(deal.monthly_revenue)}</b></div>
              <div><span>Time in business</span><b>{(deal.tib_months / 12).toFixed(1)} yrs</b></div>
              <div><span>Owner FICO</span><b>{deal.fico}</b></div>
              <div><span>Open positions</span><b>{deal.positions}</b></div>
              <div><span>NSFs, last 90 days</span><b>{deal.nsf_90d}</b></div>
              <div><span>Paper grade</span><b>{g} paper</b></div>
            </div>
          </div>
          <div className="card">
            <h3>Lender match — {matches.filter(m => m.pass).length} of {matches.length} fit</h3>
            {matches.length === 0 && <p className="note">No lenders yet. <Link href="/lenders" style={{ textDecoration: 'underline' }}>Add your lender list</Link> and every deal is scored against it.</p>}
            {matches.map(m => {
              const s = subFor(m.lender.id); const fails = m.checks.filter(c => !c.ok);
              return (
                <div className="match" key={m.lender.id}>
                  <div className="match-h"><b>{m.lender.name}</b>
                    <span className={`tag ${m.score >= 90 ? 'a' : m.score >= 65 ? 'b' : 'c'}`}>{m.score}% fit</span></div>
                  <p>{[m.lender.paper + ' paper', m.lender.factor_low && `${m.lender.factor_low}–${m.lender.factor_high}`, m.lender.speed,
                    m.lender.commission_pct != null && `${m.lender.commission_pct}% commission`].filter(Boolean).join(' · ')}</p>
                  <div className="tags">{m.checks.map(c => <span key={c.label} className={`tag ${c.ok ? 'a' : 'c'}`}>{c.ok ? '✓' : '✕'} {c.label}</span>)}</div>
                  {fails.length > 0 && <p className="fail" style={{ marginTop: 9, marginBottom: 0 }}>{fails.map(c => `${c.label}: ${c.got} (needs ${c.need})`).join(' · ')}</p>}
                  <div className="acts">
                    {!s && <button className={`btn sm ${m.pass ? 'solid' : 'flat'}`} onClick={() => submit(m.lender.id)}>{m.pass ? 'Mark submitted' : 'Mark submitted anyway'}</button>}
                    {s && <>
                      <span className={`tag ${s.status === 'offer' ? 'a' : s.status === 'declined' ? 'c' : 'b'}`} style={{ padding: '7px 10px' }}>
                        {s.status === 'sent' ? 'Submitted — waiting' : s.status === 'offer' ? 'Offer received' : 'Declined'}</span>
                      {s.status !== 'offer' && <button className="btn sm flat" onClick={() => setStatus(s, 'offer')}>Offer in</button>}
                      {s.status !== 'declined' && <button className="btn sm flat" onClick={() => setStatus(s, 'declined')}>Declined</button>}
                      <button className="btn sm flat" onClick={() => run(supabase.from('submissions').delete().eq('id', s.id))}>Undo</button>
                    </>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div>
          <div className="card">
            <h3>Contact</h3>
            <div className="kv" style={{ gridTemplateColumns: '1fr' }}>
              <div><span>Owner</span><b>{deal.owner_name || '—'}</b></div>
              <div><span>Phone</span><b>{deal.phone ? <a href={`tel:${deal.phone}`}>{deal.phone}</a> : '—'}</b></div>
              <div><span>Email</span><b>{deal.email ? <a href={`mailto:${deal.email}`}>{deal.email}</a> : '—'}</b></div>
              <div><span>Use of funds</span><b>{deal.use_of_funds || '—'}</b></div>
              {deal.notes && <div><span>Notes</span><b style={{ fontWeight: 500 }}>{deal.notes}</b></div>}
            </div>
          </div>
          <form className="card" onSubmit={saveFunding}>
            <h3>Funding</h3>
            <div className="form">
              <div><label>Funded amount ($)</label><input name="funded_amount" inputMode="numeric" required defaultValue={deal.funded_amount ?? ''} /></div>
              <div><label>Commission ($)</label><input name="commission" inputMode="numeric" required defaultValue={deal.commission ?? ''} /></div>
            </div>
            <button className="btn flat" style={{ marginTop: 13 }}>Save and mark funded</button>
          </form>
          <div className="card"><button className="btn danger" onClick={remove}>Delete deal</button></div>
        </div>
      </div>
      {editing && <DealForm deal={deal} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); load(); }} />}
    </>
  );
}
