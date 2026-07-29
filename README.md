# Commonwealth Inspection Services, LLC. — booking + route scheduler

Public booking site + owner admin dashboard for an asbestos/mold inspection
business in metro Boston. Customers pick a date and AM/PM window (never an
exact time); every morning a cron job computes the optimal driving order for
the day's jobs and emails it to the owner. See
`asbestos-scheduler-master-prompt_1.md` for the full product spec this was
built from.

## Stack

Next.js 14 (App Router, TypeScript) · Supabase (Postgres) · Stripe Invoicing
(net-30) · Google Maps Platform (Geocoding + Routes API) · Resend (email) ·
Vercel (hosting + Cron). Tailwind for styling.

## Local setup

```bash
npm install
cp .env.example .env.local   # fill in the values below
npm run dev
```

Runs at http://localhost:3000. The booking form is the home page; the admin
dashboard is at `/admin/login`.

### Environment variables

| Var | Where to get it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase project → Settings → API |
| `STRIPE_SECRET_KEY` | Stripe dashboard → Developers → API keys |
| `STRIPE_WEBHOOK_SECRET` | Created when you register the webhook (see below) |
| `GOOGLE_MAPS_API_KEY` | Google Cloud Console — enable **Geocoding API** and **Routes API** on this key |
| `RESEND_API_KEY` | Resend dashboard → API Keys |
| `OWNER_EMAIL` | Where the morning route + area-health emails go |
| `CRON_SECRET` | Any random string — set the *same* value as a Vercel env var; Vercel automatically sends it as `Authorization: Bearer $CRON_SECRET` on cron requests |
| `ADMIN_PASSWORD` | The single admin login password |

### Database

Run `supabase/schema.sql` in the Supabase SQL editor (or `supabase db push`
if you're using the CLI). It creates `customers`, `jobs`, `daily_routes`,
`settings`, and seeds one `settings` row with the defaults from the spec.

Edit the seeded values (service area, hours, prices, service types, alert
thresholds) later from the admin **Settings** page — no redeploy needed.

### Stripe webhook

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe   # for local dev
```

In production, register a webhook endpoint at
`https://<your-domain>/api/webhooks/stripe` listening for `invoice.paid`, and
put its signing secret in `STRIPE_WEBHOOK_SECRET`.

### Resend sending domain

Update the `FROM` address in `src/lib/email.ts` to a domain you've verified
in Resend (the default `booking@commonwealthinspection.com` is a placeholder
and won't send until you own and verify that domain, or swap it for one you
do).

## Tests

```bash
npm test
```

Covers the pure route-ordering engine (`src/lib/routing.ts`) and the
area-health threshold logic (`src/lib/area-health.ts`) — the two places
correctness matters most and that don't require live API calls.

## Deploying

1. Push to a Git repo and import it into Vercel.
2. Add all the env vars above in Vercel project settings (Production +
   Preview as needed).
3. `vercel.json` already declares the two cron jobs:
   - `/api/cron/morning-route` — daily at 09:00 UTC (05:00 ET in EDT, 04:00
     ET in EST — see the comment in that route for why a single fixed UTC
     time was chosen over polling for local time).
   - `/api/cron/area-health` — Mondays at 10:00 UTC (~05:00–06:00 ET).
4. Deploy. Vercel auto-injects the `Authorization: Bearer $CRON_SECRET`
   header on cron requests, so no extra config is needed there.
5. Visit `/admin/login`, sign in with `ADMIN_PASSWORD`, and adjust settings
   (business name in emails, base address, prices, disclaimer text) to
   taste.

## Notable design choices

- **No exact appointment times.** Customers pick a date + AM/PM window only;
  the morning route optimizer (§7 of the spec) decides the actual order and
  ETAs.
- **Capacity, not rejection.** A full date auto-offers the next open date
  instead of turning the customer away; the *only* rejection path is being
  outside the service-area radius, which routes to a waitlist capture.
- **Pricing is base + per-sample**, so invoices aren't generated until the
  owner enters a sample count at job completion (`/api/admin/jobs/[id]/complete`).
- **Single owner, single admin password** — no user table, no RBAC. See
  `src/lib/auth.ts`.
