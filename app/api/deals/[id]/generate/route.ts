// Reads a deal's application + bank statements and fills the deal in.
// Runs on the server so the Anthropic key never reaches the browser. Every database and file read
// goes through the signed-in user's own Supabase session, so the team-only rules still apply.
import { createClient } from '@supabase/supabase-js';
import { DOCS_BUCKET, type Deal, type DealDocument } from '@/lib/types';
import { EXTRACT_PROMPT, EXTRACT_TOOL, mergeExtractions, planBatches, planRenames, planUpdate, statementSortKey, type AutoSummary, type Extraction } from '@/lib/autofill';

export const runtime = 'nodejs';
export const maxDuration = 300;

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
// Several accounts x several months is a lot of pages, so statements are read in batches (in parallel) and merged.
const MAX_BATCH_BYTES = 20 * 1024 * 1024; // Anthropic takes up to 32 MB per request; files grow by a third when encoded
const MAX_BATCH_FILES = 6;                 // statements per request, to stay well under the page limit
const MAX_STATEMENTS = 40;                 // e.g. 5 accounts x 8 months
const PARALLEL = 3;
const IMAGE: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

const fail = (status: number, error: string) => Response.json({ error }, { status });
/** The request was too many pages or tokens for one read; the caller splits the batch and tries again. */
class TooMuch extends Error {}

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
  const stmts = docs.filter(x => x.kind === 'bank_statement').sort((a, b) => statementSortKey(a.file_name).localeCompare(statementSortKey(b.file_name), undefined, { numeric: true }));
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
    // Application first, then statements in name order (which keeps one bank's statements together).
    const skipped: string[] = [];
    const readable = (doc: DealDocument) => {
      const ext = (doc.file_name.split('.').pop() ?? '').toLowerCase();
      if (ext !== 'pdf' && ext !== 'csv' && !IMAGE[ext]) {
        skipped.push(`${doc.file_name} — ${ext === 'heic' || ext === 'heif' ? 'iPhone photo format; save it as JPG or PDF' : 'this file type can’t be read; upload a PDF'}`);
        return false;
      }
      if (doc.size_bytes > MAX_BATCH_BYTES) { skipped.push(`${doc.file_name} — too big to read (over 20 MB); save a smaller PDF`); return false; }
      return true;
    };
    const appDocs = apps.filter(readable);
    let stmtDocs = stmts.filter(readable);
    if (stmtDocs.length > MAX_STATEMENTS) {
      skipped.push(...stmtDocs.slice(MAX_STATEMENTS).map(x => `${x.file_name} — only ${MAX_STATEMENTS} statements are read at a time`));
      stmtDocs = stmtDocs.slice(0, MAX_STATEMENTS);
    }
    if (!appDocs.length || !stmtDocs.length)
      throw new Error(`Couldn't read ${!appDocs.length ? 'the application' : 'any bank statement'}: ${skipped.join('; ') || 'no readable file'}.`);

    const refOf = new Map(stmtDocs.map((x, i) => [x.id, `S${i + 1}`])); // tag each statement so it can be renamed afterwards
    const toBlocks = async (doc: DealDocument): Promise<Block[] | null> => {
      const ext = (doc.file_name.split('.').pop() ?? '').toLowerCase();
      const label = doc.kind === 'application' ? `Application: ${doc.file_name}` : `Bank statement [${refOf.get(doc.id)}]: ${doc.file_name}`;
      const file = await db.storage.from(DOCS_BUCKET).download(doc.storage_path);
      if (file.error || !file.data) { skipped.push(`${doc.file_name} — couldn't open the stored file`); return null; }
      const buf = Buffer.from(await file.data.arrayBuffer());
      if (ext === 'pdf') return [{ type: 'document', title: label, source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') } }];
      if (ext === 'csv') return [{ type: 'text', text: `${label}\n${buf.toString('utf8').slice(0, 200_000)}` }];
      return [{ type: 'text', text: label }, { type: 'image', source: { type: 'base64', media_type: IMAGE[ext], data: buf.toString('base64') } }];
    };

    const appBlocks: Block[] = [];
    for (const doc of appDocs) { const b = await toBlocks(doc); if (b) appBlocks.push(...b); }
    if (!appBlocks.length) throw new Error(`Couldn't read the application: ${skipped.join('; ')}.`);
    const appBytes = appDocs.reduce((n, x) => n + Number(x.size_bytes || 0), 0);

    const today = new Date();
    const batches = planBatches(stmtDocs, Math.max(MAX_BATCH_BYTES - appBytes, 4 * 1024 * 1024), MAX_BATCH_FILES);
    let read = appDocs.length;

    // One request: the application rides with the first batch only. A batch that is still too many pages is halved and retried.
    const runBatch = async (group: DealDocument[], first: boolean, label: string): Promise<Extraction[]> => {
      const blocks: Block[] = first ? [...appBlocks] : [];
      let got = 0;
      for (const doc of group) { const b = await toBlocks(doc); if (b) { blocks.push(...b); got++; } }
      if (!got && !first) return [];
      const note = batches.length === 1 && group.length === stmtDocs.length ? ''
        : first ? `These are the application and some of the merchant's bank statements (${label}); the other statements are read separately. `
        : `These are more bank statements for the same merchant (${label}). The application was read separately — leave every application field empty. `;
      blocks.push({ type: 'text', text: `${note}Today is ${today.toISOString().slice(0, 10)}. Read the files above and reply with the JSON.` });
      try {
        const ex = await askClaude(key, blocks);
        read += got;
        return [ex];
      } catch (e) {
        if (!(e instanceof TooMuch) || group.length < 2) throw e;
        const half = Math.ceil(group.length / 2);
        const a = await runBatch(group.slice(0, half), first, label + 'a');
        const b = await runBatch(group.slice(half), false, label + 'b');
        return [...a, ...b];
      }
    };

    const results: Extraction[][] = new Array(batches.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(PARALLEL, batches.length) }, async () => {
      while (next < batches.length) {
        const i = next++;
        results[i] = await runBatch(batches[i], i === 0, `batch ${i + 1} of ${batches.length}`);
      }
    }));
    const ex = mergeExtractions(results.flat());
    if (!ex.statements.length) throw new Error('The document reader found no statement months in these files. Check they are bank statements.');

    // Rename each statement the reader could date: "November 2026 xxxx1234.pdf". The first name is kept in original_name.
    const idOf = new Map([...refOf].map(([docId, ref]) => [ref, docId]));
    const found = (ex.files ?? []).flatMap(f => { const docId = idOf.get(String(f.ref ?? '').trim().toUpperCase()); return docId ? [{ ...f, id: docId }] : []; });
    const allNames = await db.from('documents').select('id, file_name').eq('deal_id', id);
    let renamed = 0;
    for (const r of planRenames(allNames.data ?? stmtDocs, found.filter((f, i) => found.findIndex(x => x.id === f.id) === i))) {
      const doc = stmtDocs.find(x => x.id === r.id)!;
      const up = await db.from('documents').update({ file_name: r.file_name, original_name: doc.original_name ?? doc.file_name }).eq('id', r.id);
      if (!up.error) renamed++;
    }

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
      flags: plan.flags, changed: renamed ? [...plan.changed, `Renamed ${renamed} bank statement${renamed > 1 ? 's' : ''} by month and account`] : plan.changed, skipped_files: skipped, files_read: read,
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
      if (r.status === 400 && /too long|pages|too large|exceed/i.test(m)) throw new TooMuch('A statement is too many pages to read. Split it into smaller PDFs (one month each) and try again.');
      if (r.status === 400 && /password|encrypt/i.test(m)) throw new Error('A PDF is password-protected. Ask the merchant for an unlocked copy.');
      if (r.status === 429 || r.status === 529) throw new Error('The document reader is busy right now. Try again in a minute.');
      throw new Error(`The document reader couldn't finish: ${m}`);
    }
    if (j.stop_reason === 'max_tokens') throw new TooMuch('A statement has too much in it to read. Split it into smaller PDFs (one month each) and try again.');
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
      files: Array.isArray(x.files) ? x.files : [],
    };
  }
}
