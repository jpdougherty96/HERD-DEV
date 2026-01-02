# HERD (Homesteading Experiences & Classes) — Investor/Technical Review

HERD is a marketplace for **homestead-style, in-person classes** (e.g., cooking, canning, gardening, DIY skills) where **hosts list classes** and **guests book seats**.  
Payments run through **Stripe Checkout** and are finalized via **Supabase Edge Functions + webhooks**, supporting *host approval workflows* (auto-approve vs. manual approve) and *delayed payout release*.

> Live: **herd.rent**  
> Staging: (configure via `SITE_URL` and your Vercel/Supabase project settings)

---

## Tech Stack

**Frontend**
- React 18 + TypeScript
- Vite
- TailwindCSS + Radix UI primitives
- Sonner toast notifications
- Recharts (analytics components)

**Backend**
- Supabase (Postgres, Auth, Storage)
- Supabase Edge Functions (Deno)
- Row Level Security (RLS) enforced on core tables

**Payments**
- Stripe Checkout
- Stripe Webhooks (platform + Connect events supported)
- Manual capture for host-approval bookings; automatic capture for auto-approve bookings

**Ops / Automation**
- GitHub Actions Cron → calls Supabase Edge Functions for scheduled jobs

---

## Repository Layout (high level)

- `src/` — React application (UI, pages, components, hooks)
- `supabase/`
  - `functions/` — Edge Functions (Stripe, bookings, emails, scheduled jobs)
  - `migrations/` — Database schema & changes
- `vercel.json` — SPA fallback routing for Vercel

---

## Local Development

### 1) Install dependencies
```bash
npm install
```

### 2) Configure environment variables
Create a `.env.local` (Vite) in the project root:

```bash
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

> Vite only exposes variables prefixed with `VITE_` to the browser.

Edge Functions use Supabase project secrets (set via Supabase CLI or Dashboard). See “Supabase Edge Function Secrets” below.

### 3) Run the app
```bash
npm run dev
```

Vite runs on `http://localhost:3000` (see `vite.config.ts`).

---

## Supabase Setup

### Supabase CLI
This repo includes a `supabase/` directory with migrations and Edge Functions.

If you manage Supabase locally:
```bash
supabase start
supabase db reset
supabase functions serve
```

If you link to a remote Supabase project:
```bash
supabase link --project-ref <YOUR_PROJECT_REF>
```

### Supabase Edge Function Secrets

Edge Functions expect (at minimum):

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` *(server-side only; never in the browser)*
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_CONNECT_WEBHOOK_SECRET` (if using Connect webhooks)
- `SITE_URL`
- `CRON_SECRET`

Optional / feature-dependent:
- `HERD_FEE_RATE` (default 0.15)
- `PAYOUT_BUFFER_HOURS` (default 24)
- `RESEND_API_KEY` / `EMAILS_KEY` (if using Resend / email sending)

Set secrets in Supabase:
```bash
supabase secrets set \
  SUPABASE_URL="..." \
  SUPABASE_SERVICE_ROLE_KEY="..." \
  STRIPE_SECRET_KEY="..." \
  STRIPE_WEBHOOK_SECRET="..." \
  SITE_URL="https://herd.rent" \
  CRON_SECRET="..."
```

---

## Payments & Booking Flow (Conceptual)

### Guest booking
1. Guest selects a class + quantity (seats).
2. Frontend calls `create-checkout-session` Edge Function.
3. Stripe Checkout collects payment.

### Webhook fulfillment
1. `stripe-webhook` receives `checkout.session.completed`.
2. Booking record is created in `bookings` with:
   - `status`: `APPROVED` or `PENDING` (based on class `auto_approve`)
   - `payment_status`: `HELD` or `PENDING`
   - computed platform fee + host payout split
3. Additional reconciliation info is stored (charge, Stripe fees, etc.) best-effort.

### Host approval (manual approval classes)
- Host approves/denies:
  - `approve-booking`
  - `deny-booking`
- When approved: payment capture and hold/payout logic continues.

### Scheduled payouts / maintenance
GitHub Actions cron calls Supabase functions (see `.github/workflows/herd-cron.yml`):
- `expire-pending-bookings`
- `send-unread-message-alerts`
- `release-held-payments`
- `send-review-invites`
- `emails`

---

## Deployment Notes

### Vercel
- `vercel.json` provides SPA fallback routing so deep links work.
- Set Vercel environment vars:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`

### Supabase
- Deploy Edge Functions:
```bash
supabase functions deploy create-checkout-session
supabase functions deploy stripe-webhook
# ...deploy others as needed
```

---

## Security & Operational Guardrails

- Never commit:
  - `.env.local`
  - Supabase service role keys
  - Stripe secret keys
  - Resend keys
- Always keep RLS enabled on user-facing tables.
- Webhooks are idempotent (logged by Stripe event id); keep unique indexes in place.
- Scheduled jobs require `x-cron-secret` header.

---

## Roadmap (near-term)
- Production-hardening pass (remove dev helpers / debug logs; tighten types)
- Standardize routing (either fully React Router, or fully internal state routing)
- Improve observability (structured logs + error reporting)
- Add CI checks (typecheck, lint, build)

---

## License
Proprietary — all rights reserved (adjust if you plan to open source parts).
