'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { STAGES, money, type Deal, type Lender } from '@/lib/types';
import { matchAll, paperGrade } from '@/lib/matching';
import DealForm from '@/components/DealForm';

export default function Pipeline() {
  const [deals, setDeals] = useState<Deal[] | null>(null);
  const [lenders, setLenders] = useState<Lender[]>([]);
  const [err, setErr] = useState('');
  const [adding, setAdding] = useState(false);
  const router = useRouter();

  useEffect(() => {
    (async () => {
      const [d, l] = await Promise.all([
        supabase.from('deals').select('*').order('created_at', { ascending: false }),
        supabase.from('lenders').select('*'),
      ]);
      if (d.error || l.error) { setErr((d.error ?? l.error)!.message); return; }
      setDeals(d.data as Deal[]); setLenders(l.data as Lender[]);
    })();
  }, []);

  if (err) return <div className="err">Couldn&apos;t load deals: {err}</div>;
  if (!deals) return <span className="note">Loading…</span>;

  const open = deals.filter(d => !['funded', 'declined'].includes(d.stage));
  const funded = deals.filter(d => d.stage === 'funded');
  const sum = (xs: Deal[], k: 'amount_requested' | 'funded_amount' | 'commission') => xs.reduce((s, d) => s + (d[k] ?? 0), 0);

  return (
    <>
      <div className="head">
        <div><h1>Pipeline</h1><p>{deals.length} deals · {lenders.filter(l => l.active).length} active lenders</p></div>
        <button className="btn solid" onClick={() => setAdding(true)}>New deal</button>
      </div>
      <div className="stats">
        <div className="stat"><span>Open requests</span><b>{money(sum(open, 'amount_requested'))}</b></div>
        <div className="stat"><span>Open deals</span><b>{open.length}</b></div>
        <div className="stat"><span>Funded</span><b>{money(sum(funded, 'funded_amount'))}</b></div>
        <div className="stat"><span>Commission</span><b style={{ color: 'var(--ok)' }}>{money(sum(funded, 'commission'))}</b></div>
      </div>
      <div className="board">
        {STAGES.map(([key, title]) => {
          const ds = deals.filter(d => d.stage === key);
          return (
            <div className="col" key={key}>
              <div className="col-h"><span>{title}</span><span>{ds.length}</span></div>
              {ds.length === 0 && <div className="empty">—</div>}
              {ds.map(d => {
                const g = paperGrade(d); const fit = matchAll(d, lenders).filter(m => m.pass).length;
                return (
                  <Link className="deal" key={d.id} href={`/deals/${d.id}`}>
                    <b>{d.business}</b>
                    <div className="meta">{[d.city, d.industry].filter(Boolean).join(' · ')}</div>
                    <div className="amt">{money(d.amount_requested)}</div>
                    <div className="tags">
                      <span className={`tag ${g.toLowerCase()}`}>{g} paper</span>
                      <span className="tag">{d.fico}</span>
                      {d.positions > 0 && <span className="tag">{d.positions} pos</span>}
                      <span className={`tag ${fit ? 'a' : 'c'}`}>{fit} fit</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          );
        })}
      </div>
      {adding && <DealForm onClose={() => setAdding(false)} onSaved={id => router.push(`/deals/${id}`)} />}
    </>
  );
}
