# FundHaus app

Broker console for FundHaus: team sign-in, lender list, deals, and automatic lender matching.
Built with Next.js and Supabase, deployed on Vercel.

## Stage 1 (this version)
- Team sign-in. Only emails on the `team` list can see anything.
- Lenders: each lender's minimums (revenue, time in business, FICO, positions, amount, excluded industries).
- Deals: pipeline board by stage, deal page, funding and commission.
- Matching: every deal is scored against every active lender (`lib/matching.ts`, tests in `lib/matching.test.ts`).

Not in yet: merchant-facing screens, document upload, anything involving SSNs or bank statements.

## Setup
1. Supabase → SQL Editor → run `supabase/schema.sql`.
2. Supabase → SQL Editor → add yourself to the team: `insert into team (email) values ('you@example.com');`
3. Supabase → Authentication → Users → Add user (same email, choose a password).
4. Supabase → Authentication → Sign In / Providers → turn off "Allow new users to sign up".
5. Vercel → import this repository → add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (see `.env.example`) → Deploy.

## Commands
- `npm run dev` — run locally
- `npm test` — matching tests
- `npm run build` — production build
