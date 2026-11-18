// Reads a deal's application + bank statements and fills the deal in.
// Runs on the server so the Anthropic key never reaches the browser. Every database and file read
// goes through the signed-in user's own Supabase session, so the team-only rules still apply.
import { createClient } from '@supabase/supabase-js';
import { DOCS_BUCKET, type Deal, type DealDocument } from '@/lib/types';
import { EXTRACT_PROMPT, EXTRACT_TOOL, planUpdate, type AutoSummary, type Extraction } from '@/lib/autofill';

export const runtime = 'nodejs';
export const maxDuration = 300;

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
const MAX_TOTAL_BYTES = 22 * 1024 * 1024; // Anthropic takes up to 32 MB per request; files grow by a third when encoded
const IMAGE: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

const fail = (status: number, error: string) => Response.json({ error }, { status });

type Block =
  | { type: 'text'; text: string }
  | { type: 'document'; title: string; source: { type: 'base64'; media_type: 'application/pdf'; data: string } }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return fail(401, 'Sign in again and retry.');
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return fail(503, "The document reader isn't switched on yet. Add ANTHROPIC_API_KEY in Vercel → Settings → Environment Variables, then redeploy.");

  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const d = await db.from('deals').select('*').eq('id', id).maybeSingle();
  if (d.error) return fail(500, d.error.message);
  if (!d.data) return fail(404, 'Deal not found.');
  const deal = d.data as Deal;

  const docsQ = await db.from('documents').select('*').eq('deal_id', id).in('kind', ['application', 'bank_statement']).order('created_at');
  if (docsQ.error) return fail(500, docsQ.error.message);
  const docs = docsQ.data as DealDocument[];
  const apps = docs.filter(x => x.kind === 'application');
  const stmts = docs.filter(x => x.kind === 'bank_statement').sort((a, b) => a.file_name.localeCompare(b.file_name));
  if (!apps.length || !stmts.length) return fail(400, 'Upload the application and at least one bank statement first.');

  // Claim the deal so two people opening it at once don't both read it. A run older than 5 minutes is treated as dead.
  const stale = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const claim = await db.from('deals')
    .update({ auto_status: 'running', auto_started_at: new Date().toISOString(), auto_error: null })
    .eq('id', id).or(`auto_status.is.null,auto_status.neq.running,auto_started_at.lt.${stale}`)
    .select('id');
  if (claim.error) return fail(500, claim.error.message);
  if (!claim.data?.length) return fail(409, 'These documents are already being read. Give it a minute.');

  try {
    // Build the request: application first, then statements in name order.
    const blocks: Block[] = [];
    const skipped: string[] = [];
    let total = 0, read = 0, gotApp = false, gotStmt = false;
    for (const doc of [...apps, ...stmts]) {
      const ext = (doc.file_name.split('.').pop() ?? '').toLowerCase();
      const label = `${doc.kind === 'application' ? 'Application' : 'Bank statement'}: ${doc.file_name}`;
      if (ext !== 'pdf' && ext !== 'csv' && !IMAGE[ext]) {
        skipped.push(`${doc.file_name} — ${ext === 'heic' || ext === 'heif' ? 'iPhone photo format; save it as JPG or PDF' : 'this file type can’t be read; upload a PDF'}`);
        continue;
      }
      if (total + doc.size_bytes > MAX_TOTAL_BYTES) { skipped.push(`${doc.file_name} — too much to read in one go; the rest were read`); continue; }
      const file = await db.storage.from(DOCS_BUCKET).download(doc.storage_path);
      if (file.error || !file.data) { skipped.push(`${doc.file_name} — couldn't open the stored file`); continue; }
      const buf = Buffer.from(await file.data.arrayBuffer());
      total += buf.length; read++;
      if (doc.kind === 'application') gotApp = true; else gotStmt = true;
      if (ext === 'pdf') blocks.push({ type: 'document', title: label, source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') } });
      else if (ext === 'csv') blocks.push({ type: 'text', text: `${label}\n${buf.toString('utf8').slice(0, 200_000)}` });
      else { blocks.push({ type: 'text', text: label }); blocks.push({ type: 'image', source: { type: 'base64', media_type: IMAGE[ext], data: buf.toString('base64') } }); }
    }
    if (!gotApp || !gotStmt)
      throw new Error(`Couldn't read ${!gotApp ? 'the application' : 'any bank statement'}: ${skipped.join('; ') || 'no readable file'}.`);

    const today = new Date();
    blocks.push({ type: 'text', text: `Today is ${today.toISOString().slice(0, 10)}. Read the files above and reply with the JSON.` });

    const ex = await askClaude(key, blocks);

    const existing = await db.from('positions').select('funder, status').eq('deal_id', id);
    if (existing.error) throw new Error(existing.error.message);
    const plan = planUpdate(deal, ex, existing.data ?? [], today);

    if (plan.add.length) {
      const ins = await db.from('positions').insert(plan.add.map(p => ({ ...p, deal_id: id })));
      if (ins.error) throw new Error(`Couldn't add the positions found: ${ins.error.message}`);
    }
    const summary: AutoSummary = {
      months: [...ex.statements].sort((a, b) => a.month.localeCompare(b.month)),
      avg_revenue: plan.totals.avg_revenue, avg_deposits: plan.totals.avg_deposits, nsf_90d: plan.totals.nsf_90d,
      flags: plan.flags, changed: plan.changed, skipped_files: skipped, files_read: read,
    };
    const up = await db.from('deals').update({
      ...plan.update, auto_status: 'done', auto_generated_at: new Date().toISOString(), auto_error: null, auto_summary: summary,
    }).eq('id', id);
    if (up.error) throw new Error(up.error.message);
    return Response.json({ ok: true, changed: plan.changed, flags: plan.flags, skipped });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.from('deals').update({ auto_status: 'failed', auto_error: msg }).eq('id', id);
    return fail(500, msg);
  }
}

async function askClaude(key: string, content: Block[]): Promise<Extraction> {
  const body = JSON.stringify({
    model: MODEL, max_tokens: 16000, system: EXTRACT_PROMPT,
    // JSON outputs: the reply is constrained to this schema (newer models don't allow forcing a tool).
    output_config: { format: { type: 'json_schema', schema: EXTRACT_TOOL.input_schema } },
    messages: [{ role: 'user', content }],
  });
  for (let attempt = 1; ; attempt++) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', body,
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    });
    if ((r.status === 429 || r.status === 529 || r.status >= 500) && attempt < 3) { await new Promise(res => setTimeout(res, attempt * 4000)); continue; }
    const j = await r.json().catch(() => null);
    if (!r.ok) {
      const m: string = j?.error?.message ?? r.statusText;
      if (r.status === 401) throw new Error('The ANTHROPIC_API_KEY in Vercel was rejected. Check the key and redeploy.');
      if (r.status === 400 && /credit|billing/i.test(m)) throw new Error('The Anthropic account is out of credit. Add credit in the Anthropic Console, then try again.');
      if (r.status === 400 && /too long|pages|too large|exceed/i.test(m)) throw new Error('Too many pages to read at once. Upload just the last 4 months of statements and try again.');
      if (r.status === 400 && /password|encrypt/i.test(m)) throw new Error('A PDF is password-protected. Ask the merchant for an unlocked copy.');
      if (r.status === 429 || r.status === 529) throw new Error('The document reader is busy right now. Try again in a minute.');
      throw new Error(`The document reader couldn't finish: ${m}`);
    }
    if (j.stop_reason === 'max_tokens') throw new Error('Too much to read at once. Upload just the last 4 months of statements and try again.');
    if (j.stop_reason === 'refusal') throw new Error("The document reader declined to read these files. Check they're the application and bank statements.");
    const text = (j.content ?? []).filter((c: { type: string }) => c.type === 'text').map((c: { text: string }) => c.text).join('');
    let x: Partial<Extraction>;
    try { x = JSON.parse(text); } catch { throw new Error("The document reader didn't return any figures. Try again."); }
    return {
      application: x.application ?? ({} as Extraction['application']),
      statements: Array.isArray(x.statements) ? x.statements : [],
      positions: Array.isArray(x.positions) ? x.positions : [],
      flags: Array.isArray(x.flags) ? x.flags.map(String) : [],
      statement_business_name: x.statement_business_name ?? null,
    };
  }
}
