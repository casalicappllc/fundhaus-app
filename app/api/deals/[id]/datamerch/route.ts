// Checks a deal's business against DataMerch by EIN and stores the result on the deal.
// Runs on the server so the DataMerch credentials never reach the browser; database access
// goes through the signed-in user's own Supabase session, so the team-only rules still apply.
import { createClient } from '@supabase/supabase-js';
import { normEin, parseMerchants, type DmResult } from '@/lib/datamerch';

export const runtime = 'nodejs';
export const maxDuration = 60;

const BASE = (process.env.DATAMERCH_API_URL || 'https://api.datamerch.com').replace(/\/$/, '');
const fail = (status: number, error: string) => Response.json({ error }, { status });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return fail(401, 'Sign in again and retry.');
  const dmToken = process.env.DATAMERCH_AUTH_TOKEN, dmKey = process.env.DATAMERCH_AUTH_KEY;
  if (!dmToken || !dmKey) return fail(503, "DataMerch isn't connected yet. Add DATAMERCH_AUTH_TOKEN and DATAMERCH_AUTH_KEY in Vercel → Settings → Environment Variables, then redeploy.");

  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const [d, u] = await Promise.all([db.from('deals').select('id, ein').eq('id', id).maybeSingle(), db.auth.getUser(token)]);
  if (d.error) return fail(500, d.error.message);
  if (!d.data) return fail(404, 'Deal not found.');
  const who = u.data.user?.email ?? null;

  const save = async (status: string, result: DmResult | null) => {
    const r = await db.from('deals').update({ datamerch_status: status, datamerch_checked_at: new Date().toISOString(), datamerch_result: result }).eq('id', id);
    return r.error ? fail(500, r.error.message) : Response.json({ status, result });
  };

  const ein = normEin(d.data.ein);
  if (!ein) return save('no_ein', null);

  try {
    // 1. Trade the token + key for a session token.
    const t = await fetch(`${BASE}/api/v2/get_token`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ auth: { authentication_token: dmToken, authentication_key: dmKey } }),
    });
    const tj = await t.json().catch(() => null);
    if (!t.ok || !tj?.token) throw new Error(t.status === 401 ? 'DataMerch rejected the token and key in Vercel. Check them and redeploy.' : `DataMerch sign-in failed (${t.status}).`);

    // 2. Look the EIN up. Try the token as-is, then as a Bearer token.
    let r: Response | null = null;
    for (const auth of [tj.token as string, `Bearer ${tj.token}`]) {
      r = await fetch(`${BASE}/api/v2/merchants/${ein}`, { headers: { Authorization: auth, Accept: 'application/json' } });
      if (r.status !== 401) break;
    }
    const text = await r!.text();
    let body: unknown = null; try { body = JSON.parse(text); } catch { /* not JSON */ }
    if (r!.status === 404 && !/invalid api route/i.test(text)) return save('clear', { ein, checked_by: who, merchants: [] });
    if (!r!.ok) throw new Error(r!.status === 401 ? 'DataMerch refused the lookup. Check the API access on the DataMerch account.' : `DataMerch lookup failed (${r!.status}).`);

    const merchants = parseMerchants(body);
    return save(merchants.length ? 'hit' : 'clear', { ein, checked_by: who, merchants });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return save('error', { ein, checked_by: who, merchants: [], error: msg });
  }
}
