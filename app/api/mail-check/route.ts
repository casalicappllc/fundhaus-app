// Signs in to the mail server without sending anything, to confirm the SMTP settings work. Team members only.
import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return Response.json({ error: 'Sign in again and retry.' }, { status: 401 });
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false },
  });
  const team = await db.rpc('is_team');
  if (team.error || team.data !== true) return Response.json({ error: 'Team members only.' }, { status: 403 });

  const { SMTP_HOST, SMTP_USER, SMTP_PASS } = process.env;
  const port = Number(process.env.SMTP_PORT || 465);
  const missing = Object.entries({ SMTP_HOST, SMTP_USER, SMTP_PASS }).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) return Response.json({ ok: false, error: `Missing in Vercel: ${missing.join(', ')}` });
  try {
    await nodemailer.createTransport({ host: SMTP_HOST, port, secure: port === 465, auth: { user: SMTP_USER, pass: SMTP_PASS } }).verify();
    return Response.json({ ok: true, host: SMTP_HOST, port, user: SMTP_USER, from: process.env.SUBMIT_FROM || SMTP_USER });
  } catch (e) {
    return Response.json({ ok: false, host: SMTP_HOST, port, user: SMTP_USER, error: e instanceof Error ? e.message : String(e) });
  }
}
