'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  DndContext, DragOverlay, MouseSensor, TouchSensor, pointerWithin, useDraggable, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { supabase } from '@/lib/supabase';
import { STAGES, money, type Deal, type Lender } from '@/lib/types';
import { matchAll, paperGrade } from '@/lib/matching';
import { burden, leverageBand, type PositionLike } from '@/lib/positions';
import DealForm from '@/components/DealForm';
import { LEV_TAG } from '@/components/Positions';

type Pos = PositionLike & { deal_id: string };

export default function Pipeline() {
  const [deals, setDeals] = useState<Deal[] | null>(null);
  const [lenders, setLenders] = useState<Lender[]>([]);
  const [positions, setPositions] = useState<Pos[]>([]);
  const [err, setErr] = useState('');
  const [moveErr, setMoveErr] = useState('');
  const [adding, setAdding] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [funding, setFunding] = useState<Deal | null>(null);
  const lastDrag = useRef(0);
  const router = useRouter();

  // Mouse: drag starts after moving a few pixels, so a plain click still opens the deal.
  // Touch: press and hold for a moment, so a normal swipe still scrolls the page.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );

  useEffect(() => {
    (async () => {
      const [d, l, p] = await Promise.all([
        supabase.from('deals').select('*').order('created_at', { ascending: false }),
        supabase.from('lenders').select('*'),
        supabase.from('positions').select('deal_id, payment, frequency, status'),
      ]);
      if (d.error || l.error) { setErr((d.error ?? l.error)!.message); return; }
      setDeals(d.data as Deal[]); setLenders(l.data as Lender[]);
      if (!p.error) setPositions((p.data ?? []).map(x => ({ ...x, payment: Number(x.payment) })));
    })();
  }, []);

  if (err) return <div className="err">Couldn&apos;t load deals: {err}</div>;
  if (!deals) return <span className="note">Loading…</span>;

  const open = deals.filter(d => !['funded', 'declined'].includes(d.stage));
  const funded = deals.filter(d => d.stage === 'funded');
  const sum = (xs: Deal[], k: 'amount_requested' | 'funded_amount' | 'commission') => xs.reduce((s, d) => s + (d[k] ?? 0), 0);
  const stageName = (k: string) => STAGES.find(([key]) => key === k)?.[1] ?? k;

  /** Saves a stage change. The card moves right away and goes back if the save fails. */
  const move = async (deal: Deal, changes: Partial<Deal> & { stage: string }) => {
    const before = deal;
    setMoveErr('');
    setDeals(ds => ds && ds.map(d => d.id === deal.id ? { ...d, ...changes } : d));
    const { data, error } = await supabase.from('deals').update(changes).eq('id', deal.id).select('id');
    if (error || !data?.length) {
      setDeals(ds => ds && ds.map(d => d.id === deal.id ? before : d));
      setMoveErr(`Couldn't move ${deal.business} to ${stageName(changes.stage)}: ${error?.message ?? 'the change was not saved'}`);
    }
  };

  const onDragStart = (e: DragStartEvent) => setDragId(String(e.active.id));
  const onDragEnd = (e: DragEndEvent) => {
    setDragId(null); lastDrag.current = Date.now();
    const deal = deals.find(d => d.id === e.active.id); const stage = e.over ? String(e.over.id) : null;
    if (!deal || !stage || stage === deal.stage) return;
    // Funded needs the funded amount and commission, same as on the deal page.
    if (stage === 'funded') { setFunding(deal); return; }
    move(deal, { stage });
  };
  // Stops the click that can follow a drop from opening the deal.
  const justDragged = () => Date.now() - lastDrag.current < 300;

  const dragging = dragId ? deals.find(d => d.id === dragId) : null;
  const cardInfo = (d: Deal) => ({ d, lenders, positions: positions.filter(x => x.deal_id === d.id) });

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
      <p className="note board-hint">Drag a deal to another column to change its stage. On a phone, press and hold the card first.</p>
      {moveErr && <div className="err" style={{ marginBottom: 12 }}>{moveErr}</div>}
      <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragStart={onDragStart} onDragEnd={onDragEnd}
        onDragCancel={() => { setDragId(null); lastDrag.current = Date.now(); }}>
        <div className="board">
          {STAGES.map(([key, title]) => {
            const ds = deals.filter(d => d.stage === key);
            return (
              <Column key={key} id={key} title={title} count={ds.length}>
                {ds.length === 0 && <div className="empty">—</div>}
                {ds.map(d => <DraggableCard key={d.id} {...cardInfo(d)} justDragged={justDragged} />)}
              </Column>
            );
          })}
        </div>
        <DragOverlay dropAnimation={null}>
          {dragging && <div className="deal lifted"><CardBody {...cardInfo(dragging)} /></div>}
        </DragOverlay>
      </DndContext>
      {adding && <DealForm onClose={() => setAdding(false)} onSaved={id => router.push(`/deals/${id}`)} />}
      {funding && <FundedPrompt deal={funding} onClose={() => setFunding(null)}
        onSave={(funded_amount, commission) => { const d = funding; setFunding(null); move(d, { stage: 'funded', funded_amount, commission }); }} />}
    </>
  );
}

function Column({ id, title, count, children }: { id: string; title: string; count: number; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={`col${isOver ? ' over' : ''}`}>
      <div className="col-h"><span>{title}</span><span>{count}</span></div>
      {children}
    </div>
  );
}

type CardProps = { d: Deal; lenders: Lender[]; positions: Pos[] };

function DraggableCard({ justDragged, ...p }: CardProps & { justDragged: () => boolean }) {
  const { setNodeRef, listeners, isDragging } = useDraggable({ id: p.d.id });
  return (
    <Link ref={setNodeRef} {...listeners} className={`deal${isDragging ? ' ghost' : ''}`} href={`/deals/${p.d.id}`}
      draggable={false}
      onClick={e => { if (justDragged()) e.preventDefault(); }}
      onContextMenu={e => { if (isDragging) e.preventDefault(); }}>
      <CardBody {...p} />
    </Link>
  );
}

function CardBody({ d, lenders, positions }: CardProps) {
  const g = paperGrade(d); const fit = matchAll(d, lenders).filter(m => m.pass).length;
  const lev = burden(positions, d.monthly_revenue);
  const band = lev.count ? leverageBand(lev.pct) : null;
  return (
    <>
      <b>{d.business}</b>
      <div className="meta">{[d.city, d.industry].filter(Boolean).join(' · ')}</div>
      <div className="amt">{money(d.amount_requested)}</div>
      <div className="tags">
        <span className={`tag ${g.toLowerCase()}`}>{g} paper</span>
        <span className="tag">{d.fico}</span>
        {d.positions > 0 && <span className="tag">{d.positions} pos</span>}
        {band && <span className={`tag ${LEV_TAG[band]}`}>{Math.round(lev.pct!)}% lev</span>}
        <span className={`tag ${fit ? 'a' : 'c'}`}>{fit} fit</span>
        {d.datamerch_status === 'hit' && <span className="tag c">DataMerch hit</span>}
        {d.datamerch_status === 'clear' && <span className="tag a">DM clear</span>}
      </div>
    </>
  );
}

/** Asked when a deal is dropped on Funded: the totals on the pipeline need the real numbers. */
function FundedPrompt({ deal, onClose, onSave }: { deal: Deal; onClose: () => void; onSave: (funded: number, commission: number) => void }) {
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault(); const f = new FormData(e.currentTarget);
    const n = (k: string) => Math.max(0, Math.round(Number(String(f.get(k)).replace(/[$,\s]/g, '')) || 0));
    onSave(n('funded_amount'), n('commission'));
  };
  return (
    <div className="modal-bg" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="modal" onSubmit={submit}>
        <h2>Mark {deal.business} funded</h2>
        <div className="form">
          <div><label>Funded amount ($)</label><input name="funded_amount" inputMode="numeric" required autoFocus defaultValue={deal.funded_amount ?? ''} /></div>
          <div><label>Commission ($)</label><input name="commission" inputMode="numeric" required defaultValue={deal.commission ?? ''} /></div>
        </div>
        <div className="acts">
          <button type="button" className="btn flat" onClick={onClose}>Cancel</button>
          <button className="btn solid">Save and mark funded</button>
        </div>
      </form>
    </div>
  );
}
