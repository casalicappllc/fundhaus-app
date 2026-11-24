# FundHaus app

Broker console for FundHaus: team sign-in, lender list, deals, and automatic lender matching.
Built with Next.js and Supabase, deployed on Vercel.

## Stage 1 (this version)
- Team sign-in. Only emails on the `team` list can see anything.
- Lenders: each lender's minimums (revenue, time in business, FICO, positions, amount, excluded industries).
- Deals: pipeline board by stage, deal page, funding and commission. Drag a card to another column to change its stage (on a phone, press and hold first); dropping on Funded asks for the funded amount and commission.
- Matching: every deal is scored against every active lender (`lib/matching.ts`, tests in `lib/matching.test.ts`).
- Current positions: each MCA or loan the merchant is already paying, with its payment and how often it's debited. Totals the weekly and monthly payments, shows leverage (payments ÷ monthly revenue: under 25% light, 25–35% moderate, 35–48% heavy, 48%+ very heavy) on the deal and the pipeline card, and keeps the deal's open-position count in step (math in `lib/positions.ts`).
- Documents: upload bank statements, applications, IDs and more on each deal page. Files sit in a private Supabase bucket only team members can open; links expire after 60 seconds.

- Deals that fill themselves in: on **New deal → From documents**, drop in the application and bank statements. The deal is created, the files are read (by Claude, through the Anthropic API, on the server), and the deal fills in — business name, owner, contact, industry, time in business, amount requested, monthly revenue (average of true revenue over full statement months), NSFs in the last 90 days, and current positions found as recurring debits. A month-by-month table and anything a lender would ask about show at the top of the deal. It also starts by itself on any deal the first time both an application and a bank statement are on it, and **Read again** re-reads after new statements are added. Details someone typed are never overwritten; revenue and NSFs always follow the statements. Logic in `lib/autofill.ts`, tests in `lib/autofill.test.ts`, server route in `app/api/deals/[id]/generate/route.ts`. Nothing like SSNs, dates of birth or account numbers is kept (two accounts at the same bank are told apart by the last 4 digits only). Several accounts are fine: upload every account's statements (up to 40 files); they're read in batches of 6 in parallel and merged (`planBatches`, `mergeExtractions`), with each month's revenue added up across accounts and transfers between the merchant's own accounts left out.

- DataMerch check: every deal is checked against DataMerch (the funder-reported default/fraud database) by EIN as soon as it has one — read from the application, or typed in under Edit — and again if the EIN changes. A red **On DataMerch** card lists each record with its category, note and who reported it, the deal and its pipeline card are flagged, and submitting to a lender asks you to confirm. A clean result shows **DM clear**. Server route in `app/api/deals/[id]/datamerch/route.ts`, response parsing in `lib/datamerch.ts` (tests in `lib/datamerch.test.ts`).

- Send to lenders: **Send to lenders** on a deal opens a review screen — the lenders that fit (ticked if they have a submission email and haven't had it yet), the files to attach (application + bank statements by default), and an editable email. On **Send**, each lender gets its own email from the FundHaus mailbox with the files attached, the submission is recorded with who sent it and when, and the deal moves to Submitted. When the files add up to more than 18 MB (several accounts' statements), each lender gets them as "part 1 of N", "part 2 of N" … in one email thread, up to 4 emails (`packAttachments` in `lib/submit.ts`). Lenders on DataMerch need an extra "send anyway" tick. Submission emails live on each lender (Lenders page; first is To, the rest CC). Every email also CCs funding@assured-assets.com (`ALWAYS_CC` in `lib/submit.ts`). Route: `app/api/deals/[id]/submit/route.ts`; email text: `lib/submit.ts`.

- Offers: an **Offers** box on each deal — lender, amount, buy rate, sell rate, term (number of daily or weekly payments), plus notes — with payback, spread and the daily/weekly payment worked out (`lib/offers.ts`, tests in `lib/offers.test.ts`). Adding an offer marks that lender's submission "Offer received" and moves the deal to Offers in.

Not in yet: merchant-facing screens, merchant upload links, anything involving SSNs.

## Setup
1. Supabase → SQL Editor → run `supabase/schema.sql`. (Existing databases: run each `supabase/migration-*.sql` file instead, oldest first.)
2. Supabase → SQL Editor → add yourself to the team: `insert into team (email) values ('you@example.com');`
3. Supabase → Authentication → Users → Add user (same email, choose a password).
4. Supabase → Authentication → Sign In / Providers → turn off "Allow new users to sign up".
5. Vercel → import this repository → add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (see `.env.example`) → Deploy.
6. For deals that fill themselves in: create an API key at console.anthropic.com (add credit under Billing), then Vercel → Settings → Environment Variables → `ANTHROPIC_API_KEY` → Redeploy. Optional: `ANTHROPIC_MODEL` (default `claude-sonnet-5-5`).
8. For sending to lenders: in Vercel add `SMTP_HOST`, `SMTP_PORT` (465), `SMTP_USER` (the mailbox, e.g. admin@assured-assets.net), `SMTP_PASS` (its password or app password) and optionally `SUBMIT_FROM` (e.g. `Assured Assets <admin@assured-assets.net>`) → Redeploy.
7. For the DataMerch check: DataMerch → API credentials → add `DATAMERCH_AUTH_TOKEN` (Authentication Token) and `DATAMERCH_AUTH_KEY` (Authentication Key) in Vercel → Redeploy.

## Commands
- `npm run dev` — run locally
- `npm test` — matching, positions, auto-fill, DataMerch and submission tests
- `npm run build` — production build
