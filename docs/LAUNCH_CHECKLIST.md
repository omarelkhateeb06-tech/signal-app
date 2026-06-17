# SIGNAL — Launch Checklist

Status as of the Phase 12w merge (data-capture layer). Engineering is
ship-ready: a stranger can sign up → hit the paywall → pay → get Pro, and that
path works end-to-end. What remains below is **operational** (domain, email
deliverability, a few dashboard settings) plus the post-merge deploy.

Ordered so each tier unblocks the next. The critical path is **Tier 1 → #4 → #5**.

---

## Tier 1 — Finish the data-capture rollout (in-flight)

- [ ] **1. Merge `claude/data-capture-12w` → `main`** *(done by Claude if you read this in the repo)*
  - Applies migrations 0062–0065 on the next Railway deploy. Do this before the
    domain goes live so capture is collecting from your first real visitor.
- [ ] **2. Watch the deploy's migration step** — Railway runs `migrate.ts` before
  binding the port; confirm 0062–0065 apply cleanly. A migration failure halts the
  deploy (the previous deployment keeps serving), so it's safe but worth watching.
- [ ] **3. Verify capture is live** (2-min smoke after deploy)
  - Visit `/upgrade` logged in → `product_events` gets an `upgrade_viewed` row.
  - Sign up via a link with `?utm_source=test` → the new user row has `utm_source='test'`.

## Tier 2 — True launch blockers (gate handing out the URL)

- [ ] **4. Buy a domain + point it at Vercel** *(~30 min + DNS propagation)*
  - Register the domain; Vercel → Settings → Domains → add it → set the A/CNAME records.
  - Railway backend env: `FRONTEND_URL=https://yourdomain.com` and add the domain to
    `ALLOWED_ORIGINS` (the current `ALLOWED_ORIGIN_PATTERNS` only matches `*.vercel.app`).
  - Confirm Vercel `NEXT_PUBLIC_API_URL` points at the Railway backend.
  - *Blocker:* can't send paying users to `project-nvrod.vercel.app`; `FRONTEND_URL`
    is baked into every email link + unsubscribe token.
- [ ] **5. SendGrid domain authentication (SPF/DKIM/DMARC)** *(~20 min + DNS propagation)*
  - SendGrid → Settings → Sender Authentication → **Authenticate Your Domain** → add
    the CNAME records to your DNS.
  - Set `SENDER_EMAIL` on Railway to an address on that domain (e.g. `noreply@yourdomain.com`).
  - ⚠️ Also confirm `SENDGRID_API_KEY` is set on Railway — if it isn't, emails are
    silently console-logged and nothing sends.
  - *Blocker:* without it the daily digest lands in spam, and the digest **is** the Pro deliverable. Depends on #4.

## Tier 3 — Config & wiring (minutes each, no code)

- [ ] **6. Stripe Dashboard** — Settings → Business: display name → **"SIGNAL"** (currently
  "Human Machine Automation" on checkout); add policy URLs `/terms`, `/privacy`, `/refund`;
  set the customer-facing support email.
- [ ] **7. SendGrid Event Webhook** (turns on email open/click data — the 12w email layer)
  - SendGrid → Settings → Mail Settings → **Event Webhook**.
  - POST URL: `https://<backend>/api/v1/emails/webhook?token=<secret>`
  - Enable: Delivered, Opens, Clicks, Bounces, Spam reports, Unsubscribes.
  - Railway env: `SENDGRID_WEBHOOK_TOKEN=<secret>` (same value as the `?token=`).
  - Depends on #4/#5 (need the live backend URL).
- [ ] **8. Support inbox** — make sure `omar.elkhateeb@hmautomation.llc` (the address in
  the legal pages) receives mail or forwards somewhere you check. Terms promise a
  2-business-day response.
- [ ] **9. UTM-tag marketing links** — every link you post: `?utm_source=reddit&utm_medium=organic&utm_campaign=launch`.
  Without tags, `signup_source` is all "direct" and attribution can't tell you what works.
- [ ] **10. Set `ADMIN_USER_IDS` on Railway** to your prod user UUID (if not already) so the
  `/admin/reports/*` endpoints and ingestion status are reachable.

## Tier 4 — Final pre-launch validation (after Tiers 1–3)

- [ ] **11. End-to-end smoke on the live domain** *(~15 min)*
  - New signup → onboarding (try the optional company fields) → feed.
  - Hit story cap / search cap as free → paywall fires.
  - One **real** Stripe checkout (live mode, real card; refund yourself or use the
    7-day trial) → `tier` flips to `pro`; "Manage billing" portal opens.
  - Welcome email arrives in inbox, not spam (validates #5).
  - `/admin/reports/growth` returns your test signup.

## Tier 5 — Optional / post-launch (not blocking)

- [ ] FRED / YouTube / Reddit API keys on Railway (those adapters log-and-skip until set).
- [ ] LLC formation (Stripe is live without it; needed for a business bank account).
- [ ] X API access (Phase 12R.B, parked on ~$300–600/mo cost).

---

### Verdict
**Ship-ready on engineering.** You are one **domain purchase + DNS propagation**
(#4, #5) away from a legitimate public launch; everything else in Tier 3 is dashboard
clicks. Recommended order: merge + deploy (Tier 1) first so funnel/attribution data
collects the moment the domain goes live.
