'use client';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Deal, DealDocument } from '@/lib/types';

const whole = (n: number | null | undefined) => n == null ? '—' : '$' + Math.round(n).toLocaleString('en-US');
const monthName = (m: string) => new Date(m + '-15T12:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
const stamp = (s: string) => new Date(s).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** Starts the document reader for a deal. Returns an error message, or null when it worked. */
export async function generateDeal(dealId: string): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return 'Sign in again and retry.';
  try {
    const r = await fetch(`/api/deals/${dealId}/generate`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    if (r.ok) return null;
    const j = await r.json().catch(() => null);
    return j?.error ?? `The document reader stopped (${r.status}).`;
  } catch {
    return 'Lost the connection while reading. Refresh in a minute — it may have finished.';
  }
}

/** Fills the deal in from its application + bank statements, by itself, as soon as both are uploaded. */
export default function AutoFill({ deal, docs, onDone }: { deal: Deal; docs: DealDocument[] | null; onDone: () => void }) {
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState('');
  const tried = useRef(false);

  const apps = docs?.filter(d => d.kind === 'application').length ?? 0;
  const stmts = docs?.filter(d => d.kind === 'bank_statement').length ?? 0;
  const ready = apps > 0 && stmts > 0;
  const elsewhere = deal.auto_status === 'running' && !running; // started in another tab or by a teammate
  const newSince = deal.auto_generated_at && docs
    ? docs.filter(d => ['application', 'bank_statement'].includes(d.kind) && d.created_at > deal.auto_generated_at!).length : 0;

  const start = async () => {
    setRunning(true); setErr('');
    const e = await generateDeal(deal.id);
    setRunning(false);
    if (e) setErr(e);
    onDone();
  };

  // The "generates itself" part: first time both kinds of document are on the deal, read them.
  useEffect(() => {
    if (ready && !deal.auto_status && !tried.current) { tried.current = true; start(); }
  }); // eslint-disable-line react-hooks/exhaustive-deps

  // Someone else is reading it: check back until it's done.
  useEffect(() => {
    if (!elsewhere) return;
    const t = setInterval(onDone, 8000);
    return () => clearInterval(t);
  }, [elsewhere, onDone]);

  const s = deal.auto_summary;
  const busy = running || elsewhere;

  if (!s && !busy && !deal.auto_error && !err) return (
    <div className="card auto">
      <h3>Fill in from documents</h3>
      <p className="note">Upload the application and the bank statements under Documents and this deal fills itself in — business details, monthly revenue, NSFs and current positions — then gets matched to your lenders.</p>
      <div className="tags" style={{ marginTop: 10 }}>
        <span className={`tag ${apps ? 'a' : ''}`}>{apps ? '✓' : '○'} Application</span>
        <span className={`tag ${stmts ? 'a' : ''}`}>{stmts ? `✓ ${stmts} bank statement${stmts > 1 ? 's' : ''}` : '○ Bank statements'}</span>
      </div>
      {ready && <button className="btn solid" style={{ marginTop: 12 }} onClick={start}>Read documents now</button>}
    </div>
  );

  return (
    <div className="card auto">
      <h3>From the documents{s && deal.auto_generated_at && !busy && ` — read ${stamp(deal.auto_generated_at)}`}</h3>
      {busy && (
        <div className="reading">
          <span className="spin" aria-hidden />
          <div>
            <b>Reading the application and {stmts || 'the'} bank statement{stmts === 1 ? '' : 's'}…</b>
            <p className="note">Usually under a minute. The deal fills in when it's done{elsewhere ? ' — this page will update by itself' : ''}.</p>
          </div>
        </div>
      )}
      {!busy && (err || deal.auto_status === 'failed') && (
        <div className="err" style={{ marginTop: 0, marginBottom: 12 }}>
          {err || deal.auto_error} <button className="btn sm flat" style={{ marginLeft: 8 }} onClick={start} disabled={!ready}>Try again</button>
        </div>
      )}
      {s && !busy && <>
        {s.flags.length > 0 && (
          <ul className="flags">{s.flags.map((f, i) => <li key={i}>{f}</li>)}</ul>
        )}
        {s.months.length > 0 && (
          <div className="tablewrap months">
            <table>
              <thead><tr><th>Month</th><th>Deposits</th><th>Revenue</th><th># Dep</th><th>NSFs</th><th>Neg days</th><th>End bal</th><th>Avg daily</th></tr></thead>
              <tbody>
                {s.months.map((m, i) => (
                  <tr key={i} className={m.full_month ? '' : 'partial'}>
                    <td>{monthName(m.month)}{!m.full_month && <small>partial</small>}{s.months.some(x => x.account !== m.account) && m.account && <small>{m.account}</small>}</td>
                    <td>{whole(m.total_deposits)}</td><td><b>{whole(m.revenue_deposits)}</b></td><td>{m.deposit_count}</td>
                    <td className={m.nsf_count ? 'bad' : ''}>{m.nsf_count}</td><td className={m.negative_days ? 'warn' : ''}>{m.negative_days}</td>
                    <td>{whole(m.ending_balance)}</td><td>{whole(m.avg_daily_balance)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td>Average</td><td>{whole(s.avg_deposits)}</td><td><b>{whole(s.avg_revenue)}</b></td><td colSpan={5}>{s.nsf_90d} NSF{s.nsf_90d === 1 ? '' : 's'} in the last 3 months</td></tr></tfoot>
            </table>
          </div>
        )}
        <p className="note" style={{ fontSize: 12, marginTop: 8 }}>Revenue leaves out transfers between the owner&apos;s accounts, loan and MCA funding, refunds and reversals. Partial months aren&apos;t counted in the average.</p>
        {s.changed.length > 0 && (
          <details className="changed"><summary>Filled in on this deal ({s.changed.length})</summary>
            <ul>{s.changed.map((c, i) => <li key={i}>{c}</li>)}</ul>
          </details>
        )}
        {s.skipped_files.length > 0 && <p className="note warn-txt" style={{ marginTop: 8 }}>Not read: {s.skipped_files.join(' · ')}</p>}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
          <button className={`btn sm ${newSince ? 'solid' : 'flat'}`} onClick={start} disabled={!ready}>Read again</button>
          <span className="note" style={{ fontSize: 12 }}>
            {newSince ? `${newSince} new document${newSince > 1 ? 's' : ''} since the last read.` : 'Double-check before submitting. Details you typed are kept; revenue and NSFs follow the statements.'}
          </span>
        </div>
      </>}
    </div>
  );
}
