// Emails a deal to the lenders the broker picked: one email per lender (lenders never see each other),
// with the application and bank statements attached, sent from the FundHaus mailbox over SMTP.
// Database and file access go through the signed-in user's own Supabase session (team-only rules apply).
import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';
import { DOCS_BUCKET, type Deal, type DealDocument, type Lender, type Submission } from '@/lib/types';
import { personalize, recipients } from '@/lib/submit';

export const runtime = 'nodejs';
export const maxDuration = 300;

const MAX_ATTACH_BYTES = 18 * 1024 * 1024; // most mail servers cap a message at ~25 MB once encoded
const fail = (status: number, error: string) => Response.json({ error }, { status });

type Body = { lender_ids?: string[]; subject?: string; text?: string; doc_ids?: string[] };

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return fail(401, 'Sign in again and retry.');
  const { SMTP_HOST, SMTP_USER, SMTP_PASS } = process.env;
  const port = Number(process.env.SMTP_PORT || 465);
  const from = process.env.SUBMIT_FROM || SMTP_USER;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS)
    return fail(503, "Sending isn't set up yet. Add SMTP_HOST, SMTP_PORT, SMTP_USER and SMTP_PASS in Vercel → Settings → Environment Variables, then redeploy.");

  const body = (await req.json().catch(() => ({}))) as Body;
  const lenderIds = Array.isArray(body.lender_ids) ? body.lender_ids.slice(0, 60) : [];
  const subject = String(body.subject ?? '').trim().slice(0, 300);
  const text = String(body.text ?? '').trim().slice(0, 20000);
  if (!lenderIds.length) return fail(400, 'Pick at least one lender.');
  if (!subject || !text) return fail(400, 'The email needs a subject and a message.');

  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const [d, l, docsQ, s, u] = await Promise.all([
    db.from('deals').select('*').eq('id', id).maybeSingle(),
    db.from('lenders').select('*').in('id', lenderIds),
    db.from('documents').select('*').eq('deal_id', id),
    db.from('submissions').select('*').eq('deal_id', id),
    db.auth.getUser(token),
  ]);
  const e = d.error ?? l.error ?? docsQ.error ?? s.error;
  if (e) return fail(500, e.message);
  if (!d.data) return fail(404, 'Deal not found.');
  const deal = d.data as Deal;
  const lenders = l.data as Lender[];
  const subs = s.data as Submission[];
  const who = u.data.user?.email ?? null;

  // Attachments: the documents the broker ticked (default: application + bank statements).
  const all = docsQ.data as DealDocument[];
  const wanted = Array.isArray(body.doc_ids) && body.doc_ids.length
    ? all.filter(x => body.doc_ids!.includes(x.id))
    : all.filter(x => x.kind === 'application' || x.kind === 'bank_statement');
  if (!wanted.some(x => x.kind === 'application') || !wanted.some(x => x.kind === 'bank_statement'))
    return fail(400, 'Attach the application and at least one bank statement before sending.');
  const total = wanted.reduce((n, x) => n + Number(x.size_bytes || 0), 0);
  if (total > MAX_ATTACH_BYTES) return fail(400, `The attachments add up to ${(total / 1048576).toFixed(1)} MB, over the 18 MB an email can safely carry. Untick some files and try again.`);

  const attachments: { filename: string; content: Buffer }[] = [];
  for (const doc of wanted) {
    const f = await db.storage.from(DOCS_BUCKET).download(doc.storage_path);
    if (f.error || !f.data) return fail(500, `Couldn't open ${doc.file_name}: ${f.error?.message ?? 'missing file'}`);
    attachments.push({ filename: doc.file_name, content: Buffer.from(await f.data.arrayBuffer()) });
  }

  const mail = nodemailer.createTransport({ host: SMTP_HOST, port, secure: port === 465, auth: { user: SMTP_USER, pass: SMTP_PASS } });
  try { await mail.verify(); }
  catch (err) { return fail(502, `Couldn't sign in to the mail server: ${err instanceof Error ? err.message : String(err)}. Check SMTP_HOST, SMTP_PORT, SMTP_USER and SMTP_PASS in Vercel.`); }

  const results: { lender: string; ok: boolean; error?: string }[] = [];
  for (const lender of lenders) {
    const { to, cc } = recipients(lender);
    if (!to) { results.push({ lender: lender.name, ok: false, error: 'no submission email on file' }); continue; }
    try {
      await mail.sendMail({
        from, to, cc: cc.length ? cc : undefined, replyTo: from,
        subject: personalize(subject, lender.name), text: personalize(text, lender.name), attachments,
      });
      const row = { status: 'sent', sent_at: new Date().toISOString(), sent_to: [to, ...cc], sent_by: who, files_sent: attachments.length };
      const existing = subs.find(x => x.lender_id === lender.id);
      const w = existing
        ? await db.from('submissions').update(row).eq('id', existing.id)
        : await db.from('submissions').insert({ ...row, deal_id: id, lender_id: lender.id });
      results.push(w.error ? { lender: lender.name, ok: true, error: `sent, but not recorded: ${w.error.message}` } : { lender: lender.name, ok: true });
    } catch (err) {
      results.push({ lender: lender.name, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  if (results.some(r => r.ok) && ['new', 'prequal'].includes(deal.stage))
    await db.from('deals').update({ stage: 'submitted' }).eq('id', id);
  return Response.json({ results, files: attachments.length });
}
