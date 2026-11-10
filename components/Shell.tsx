'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { supabase, configured } from '@/lib/supabase';

type Gate = 'loading' | 'out' | 'notteam' | 'in';

export default function Shell({ children }: { children: React.ReactNode }) {
  const [gate, setGate] = useState<Gate>('loading');
  const [email, setEmail] = useState('');
  const path = usePathname();

  useEffect(() => {
    if (!configured) return;
    const check = async (userEmail?: string) => {
      if (!userEmail) { setGate('out'); return; }
      setEmail(userEmail);
      // Row-level security only returns team rows to team members.
      const { data } = await supabase.from('team').select('email').limit(1);
      setGate(data && data.length ? 'in' : 'notteam');
    };
    supabase.auth.getSession().then(({ data }) => check(data.session?.user.email));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => { check(s?.user.email); });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!configured) return (
    <div className="center"><div className="login">
      <span className="wordmark">FUNDHAUS</span>
      <p>The app isn&apos;t connected to its database yet. Add the two Supabase values in Vercel (Settings → Environment Variables) and redeploy.</p>
    </div></div>
  );
  if (gate === 'loading') return <div className="center"><span className="note">Loading…</span></div>;
  if (gate === 'out') return <Login />;
  if (gate === 'notteam') return (
    <div className="center"><div className="login">
      <span className="wordmark">FUNDHAUS</span>
      <p>{email} is signed in but isn&apos;t on the FundHaus team list, so there is nothing to show.</p>
      <button className="btn flat" onClick={() => supabase.auth.signOut()}>Sign out</button>
    </div></div>
  );

  const nav: [string, string][] = [['/', 'Pipeline'], ['/lenders', 'Lenders']];
  return (
    <>
      <header className="top">
        <span className="wordmark">FUNDHAUS</span>
        <nav>{nav.map(([href, label]) => {
          const on = href === '/' ? path === '/' || path.startsWith('/deals') : path.startsWith(href);
          return <Link key={href} href={href} className={on ? 'on' : ''}>{label}</Link>;
        })}</nav>
        <div className="who"><span>{email}</span><button onClick={() => supabase.auth.signOut()}>Sign out</button></div>
      </header>
      <main>{children}</main>
    </>
  );
}

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setErr(error.message);
    setBusy(false);
  };
  return (
    <div className="center"><form className="login" onSubmit={submit}>
      <span className="wordmark">FUNDHAUS</span>
      <p>Broker console — team sign-in</p>
      <div className="f"><label>Email</label><input type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} /></div>
      <div className="f"><label>Password</label><input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></div>
      <button className="btn solid" style={{ width: '100%' }} disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      {err && <div className="err">{err}</div>}
    </form></div>
  );
}
