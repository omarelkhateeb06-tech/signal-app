# Teams Smoke Test (Phase 9b)

End-to-end manual verification for the Teams/Enterprise surface. Run this
locally before merging Phase 9b-3b to `main`, and again after deploy.

## Prerequisites

- Backend running: `cd backend && npm run dev` (port 3001)
- Frontend running: `cd frontend && npm run dev` (port 3000)
- DB migrations applied (migrator runs on container start in prod; run
  `npm run db:migrate` locally if needed)
- SendGrid configured, or check backend logs for invite URLs in dev mode
- Two browser profiles (or incognito + normal) so you can act as the
  inviter and invitee at once

## Test accounts

- **Admin A** — creates the team, invites others
- **Invitee B** — brand-new email, signs up via invite link
- **Existing C** — already has a SIGNAL account, gets invited by email

---

## Steps

### 1. Create a team

1. Sign in as Admin A
2. Navigate to `/teams` → click **Create team**
3. Fill name, slug, description → submit
4. ✅ Lands on `/teams/{id}` with the team header showing your name

### 2. Configure sectors

1. From the team page click **Settings**
2. Toggle at least two sectors (e.g. `ai`, `finance`) → save
3. ✅ Returning to the team feed shows stories matching those sectors

### 3. Invite a new-to-SIGNAL user (Invitee B)

1. `/teams/{id}/members` → **Invite someone**
2. Enter Invitee B's email, role `member` → submit
3. ✅ Success banner shows the email
4. ✅ Pending invites section lists the invite with a **1** count badge
5. Grab the invite URL from the email (or backend logs in dev)

### 4. Accept the invite as a new user

1. Open the invite URL in a fresh incognito window (Invitee B)
2. ✅ Page shows team name, invitee email, and role
3. Stay on the **New to SIGNAL** tab
4. Enter full name + password (≥8 chars) → submit
5. ✅ Redirects to `/teams/{id}`; header shows the team; Invitee B is
   signed in

### 5. Invite an existing SIGNAL user (Existing C)

1. Back as Admin A, invite Existing C's email with role `admin`
2. Open invite URL while Existing C is signed in (same browser, different
   tab) — or sign in first, then open
3. ✅ Page shows the team summary and an **Accept invitation** CTA
4. Click accept → ✅ lands on team page

### 6. Invite link — wrong signed-in account

1. As Admin A, invite a *different* email (say D)
2. While still signed in as A, open D's invite link
3. ✅ Page shows the **Different account signed in** warning and a
   **Log out and continue** button (does NOT wipe session silently)

### 7. Invite link — already used

1. Open the same invite URL from step 4 again in any browser
2. ✅ Page shows the **already been accepted** state with a **Go to sign
   in** link

### 8. Invite link — expired

1. In the DB, set an invite's `expires_at` to a past timestamp (or wait
   past TTL in staging)
2. Open the URL → ✅ expired state card with no CTA

### 9. Invite link — invalid token

1. Visit `/teams/join?token=definitely-not-real`
2. ✅ Invalid-link state card; no side effects on the visitor's session

### 10. Resend and revoke invites

1. As Admin A, from `/teams/{id}/members`:
   - Click the resend icon next to a pending invite → ✅ success toast,
     email goes out again
   - Click the revoke icon → ✅ confirm dialog appears
   - Confirm → ✅ toast, invite disappears from the list
2. Open the revoked URL → ✅ invalid-link state

### 11. Dashboard

1. As Admin A, go to `/teams/{id}/dashboard`
2. ✅ Four metric cards render (Members, Comments, Saves, Sectors)
3. ✅ Pie chart shows role distribution; bar chart shows top saved
   stories (or empty state if none)
4. ✅ Stories-by-sector and top-saved-stories tables list rows
5. As Invitee B (member), visit the same URL → ✅ Only admins can view
   the dashboard — back link works

### Loading and error polish

- Slow network (Chrome DevTools throttling): ✅ Teams list, feed, and
  members list show skeletons rather than blank space
- Force the members API to 500 (devtools → block request): ✅ Teams
  error boundary catches the throw with a **Try again** button and a
  **Back to teams** link

### Mobile spot-check (375px)

- ✅ `/teams`, `/teams/{id}`, `/teams/{id}/members`, `/teams/{id}/dashboard`,
  and `/teams/join` render without horizontal scroll
- ✅ Invite form stacks vertically; dialog is readable

---

## Failure triage

| Symptom | Likely cause |
|---|---|
| Invite link goes to `/login` instead of showing join page | 401 interceptor not skipping `/teams/join` |
| Joining wipes an unrelated session | Same — check `frontend/src/lib/api.ts` |
| Dashboard renders 0 members | Not an admin, or dashboard endpoint auth failed |
| Resend/revoke buttons absent as admin | `team.role` not `admin` in `useTeam()` response |
| Charts don't load (static HTML only) | SSR not bypassed — `next/dynamic` `ssr: false` regression |
