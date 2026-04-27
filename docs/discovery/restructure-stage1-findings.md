# Repo restructure — Stage 1 discovery findings

**Run date:** 2026-04-27
**Branch:** `claude/zealous-lumiere-45dbae` (worktree branched from `main` — see Environment deviation below)
**Commit:** `d813030` (= current `main` tip)
**Working tree (logical):** `C:\dev\signal-app\OneDrive\Desktop\signal-app`
**Working tree (actual, this audit):** `C:\dev\signal-app\OneDrive\Desktop\signal-app\.claude\worktrees\zealous-lumiere-45dbae`
**Common `.git` dir:** `C:/dev/signal-app/.git` (confirmed)

### Environment deviation from prompt

The prompt said "this audit stays on `main`". The harness placed me in a fresh git worktree at `.claude/worktrees/zealous-lumiere-45dbae` on branch `claude/zealous-lumiere-45dbae`. The branch was created from `main` at `d813030`, so file content is byte-identical to `main`; all audit findings still apply. The discovery doc lives in the worktree only — uncommitted, as requested. Stage 2 will need to either (a) cherry-pick this file out of the worktree, or (b) treat it as transient and re-derive from this paste.

`git worktree list` at audit time:
```
C:/dev/signal-app                                                                      d813030 [main]
C:/dev/signal-app/OneDrive/Desktop/signal-app/.claude/worktrees/zealous-lumiere-45dbae d813030 [claude/zealous-lumiere-45dbae]
```

The primary `C:\dev\signal-app` worktree is on **branch `main`**, not detached HEAD as `CLAUDE.md` §15 prescribes for the older `signal-app-12c` primary. Likely fine — that section is partly stale per `docs/roadmap/SIGNAL-roadmap.md:32` ("Working tree at `C:\dev\signal-app\OneDrive\Desktop\signal-app\` … all gates green at the new path"), but worth flagging because two worktrees on `main` would conflict (only one is, so no current issue).

---

## TL;DR

1. **The runtime-critical surface area for the move is tiny and well-contained.** Of 295 tracked files, the only one needing an edit for things-actually-break-in-CI/prod is [`.github/workflows/ci.yml`](.github/workflows/ci.yml) (3 path refs). Everything else is either path-portable code or doc-only.
2. **The migration runner is fully portable** — `backend/src/db/migrate.ts:195` resolves migrations dir via `__dirname`, not via cwd or any relative-to-repo string. The move requires zero changes here. Same for `seed-migration-state.ts:27`.
3. **HIGH-severity pre-existing bug found:** `OneDrive/Desktop/signal-app/.claude/worktrees/vibrant-carson-3c3be9` is a tracked **gitlink** (mode `160000`, commit `2a5a6f09…`) — a leftover worktree directory accidentally committed as a submodule reference all the way back in commit `48781c2` (Phase 2, Apr 18 2026). No `.gitmodules` exists. Functionally harmless today, but the move will carry it along — recommend `git rm` cleanup either before or after the move.
4. **Vercel project root** (per `README.md:70`) is set to `OneDrive/Desktop/signal-app/frontend`. After the move it must become `frontend`. This is a **manual change in the Vercel dashboard** — not a file edit. Surface to the user; CI cannot make this change.
5. **Railway is unaffected** — `backend/Dockerfile` builds with `backend/` as the build context (Railway-side root setting, also a dashboard config). The Dockerfile itself is path-context-agnostic.
6. **CI script naming inconsistency:** the prompt's stage-2 gates list `npm run typecheck` (one word). The actual script in `backend/package.json` and `frontend/package.json` is `type-check` (with hyphen), and CI invokes it with the hyphen. Stage 2 should run `type-check` — easy to mis-type.

---

## Bug flags

Logged here, not patched per prompt rules.

- **HIGH** — `OneDrive/Desktop/signal-app/.claude/worktrees/vibrant-carson-3c3be9` is a tracked git **submodule gitlink** (`git ls-files --stage` shows mode `160000`, commit `2a5a6f09a63e23cbef9d883bc79ed66c388ef5bb`). Introduced by commit `48781c2` (Phase 2 — "Authentication 22/22 tests passing"). No `.gitmodules` file. The directory on disk is empty. **Recovery:** `git rm OneDrive/Desktop/signal-app/.claude/worktrees/vibrant-carson-3c3be9` (or post-move equivalent). Recommend cleaning during stage 2 in a dedicated commit before the `git mv` so the move doesn't drag the gitlink with it.
- **MEDIUM** — `OneDrive/Desktop/signal-app/.claude/settings.local.json:21` contains the literal absolute path `C:/Users/elkha/OneDrive/Desktop/signal-app/backend/src/db/migrations/0000_dashing_colleen_wing.sql`. This is **already stale** (working tree moved to `C:\dev\signal-app\…` per `docs/roadmap/SIGNAL-roadmap.md:32`). The Bash permission line will never match a real command anymore. The flatten won't break it further — it's already broken. Stage 2 should drop the path entirely (the `awk` permission is one-off and can be re-allowed on next prompt) or rewrite it to a workspace-relative form.
- **LOW** — `CLAUDE.md` §4 lists migrations through `0012_…` only. Disk has 17 migrations through `0015_phase12e1_events_and_candidates.sql` (added by the recent `Phase 12e.1` commit `d813030`). §4 is stale relative to current state. Not blocking the restructure; flag for the next CLAUDE.md refresh pass.
- **LOW** — `CLAUDE.md` §15 "Workspace topology" still names `C:\Users\elkha\OneDrive\Desktop\signal-app-12c\` as the primary worktree. Per `docs/roadmap/SIGNAL-roadmap.md:32` the primary is now `C:\dev\signal-app\OneDrive\Desktop\signal-app\`. The §15 prose is partially stale but explicitly disclaims itself ("see PR #42").
- **LOW** — `CLAUDE.md` §2 says "Before any mass `git mv`, rename, or 'let me flatten this' refactor, run `git ls-tree -r origin/main --name-only | head -20` and cite the output." Stage 2 should literally do this in its first commit message body.

---

## Part A: Repo structure baseline

### Worktree top level (= mirror of repo root, since worktree branched fresh from `main`)

```
.git           (file pointing to common dir)
.github/
   └── workflows/
        └── ci.yml          ← only tracked file outside the OneDrive prefix
OneDrive/
   └── Desktop/
        └── signal-app/     ← everything else lives here
```

### `OneDrive/Desktop/signal-app/` top level

```
.claude/
   ├── settings.local.json
   └── worktrees/
        └── vibrant-carson-3c3be9    ← TRACKED gitlink, see Bug flags
.gitignore
CLAUDE.md
README.md
backend/
   ├── Dockerfile
   ├── drizzle.config.ts
   ├── jest.config.js
   ├── nodemon.json
   ├── package.json
   ├── seed-data/           (stories.json + url-audit-2026-04-24.txt)
   ├── src/                 (app.ts, server.ts + 13 subdirs)
   ├── tests/               (~37 test files + helpers/, setup.ts)
   └── tsconfig.json
docs/
   ├── API.md, DEPLOYMENT.md, PHASE_9_CLOSEOUT.md
   ├── ROADMAP.md, SCHEMA.md, SMOKE_TEST_TEAMS.md
   └── roadmap/
        └── SIGNAL-roadmap.md
frontend/
   ├── components.json, next-env.d.ts, next.config.mjs
   ├── package.json, postcss.config.mjs
   ├── sentry.{client,edge,server}.config.ts
   ├── src/                 (app/, components/, hooks/, lib/, store/, types/)
   ├── tailwind.config.ts, tsconfig.json
   └── vitest.config.ts, vitest.setup.ts
package.json                 (workspaces: frontend, backend)
package-lock.json
```

### Confirmations

- `.git/` is at `C:/dev/signal-app/.git/` — **confirmed** (not nested).
- `.github/` is at the repo root (single tracked file: `.github/workflows/ci.yml`) — **confirmed** (not nested).
- `git ls-tree -r HEAD --name-only | grep -v "^OneDrive/"` returns exactly **one** line: `.github/workflows/ci.yml`. Total tracked files: **295**.

### Unexpected items

- `OneDrive/Desktop/signal-app/.claude/worktrees/` — a **tracked path** (via the gitlink). `.claude/worktrees/` is the canonical CC-spawn location; tracking anything under it was unintentional. See Bug flags.
- `docs/discovery/` — does not exist. The audit-findings-doc-from-12e.2.1 the prompt referenced was either committed elsewhere or never landed. This stage's findings doc creates the directory.
- `docs/workflow/` — referenced by the prompt as the home of the worktree-hygiene doc from PR #42. **Does not exist.** PR #42 added the worktree-hygiene rule directly into `CLAUDE.md` §15, not as a separate workflow doc. (Worth confirming with `gh pr view 42` if the planner wants to be sure.)

---

## Part B: CI workflow audit

Single workflow file: `.github/workflows/ci.yml`.

### Triggers

```yaml
on:
  pull_request:
  push:
    branches: [main, develop]
```

### Path references

| Line | Construct                                  | Value                                            | Post-move action                                  |
|------|--------------------------------------------|--------------------------------------------------|---------------------------------------------------|
| 12   | comment                                    | `"OneDrive/Desktop/signal-app/ (historical layout)"` | delete the comment block (lines 12–13)            |
| 16   | `defaults.run.working-directory`           | `OneDrive/Desktop/signal-app`                    | **delete the entire `defaults:` block** (jobs run from repo root after move) |
| 36   | `actions/setup-node` `cache-dependency-path` (backend job) | `OneDrive/Desktop/signal-app/package-lock.json` | change to `package-lock.json`                      |
| 53   | `actions/setup-node` `cache-dependency-path` (frontend job) | `OneDrive/Desktop/signal-app/package-lock.json` | change to `package-lock.json`                      |

No `cd <path>` invocations in any `run:` step. No other `path:` refs in the workflow.

### What breaks pre-edit

After `git mv`, `OneDrive/` no longer exists. The `defaults.run.working-directory: OneDrive/Desktop/signal-app` would make every `npm` step `cd` into a non-existent path → step fails immediately. Both `cache-dependency-path` lookups would also miss, but `actions/setup-node` treats missing cache-dependency as a soft warning, not a failure — so the breakage is from `working-directory`, not the cache lines.

### Required fix (stage 2)

Rewrite to:
```yaml
on:
  pull_request:
  push:
    branches: [main, develop]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  backend:
    name: Backend
    runs-on: ubuntu-latest
    env:
      NODE_ENV: test
      JWT_SECRET: ci-jwt-secret-placeholder
      JWT_EXPIRES_IN: 1h
      DATABASE_URL: postgresql://test:test@localhost:5432/test
      REDIS_URL: ""
      SENDGRID_API_KEY: ""
      DISABLE_EMAIL_SCHEDULER: "1"
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"
          cache-dependency-path: package-lock.json
      - run: npm ci --no-audit --no-fund
      - run: npm run lint --workspace=backend
      - run: npm run type-check --workspace=backend
      - run: npm run test --workspace=backend

  frontend:
    name: Frontend
    runs-on: ubuntu-latest
    env:
      NEXT_PUBLIC_API_URL: http://localhost:3001
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"
          cache-dependency-path: package-lock.json
      - run: npm ci --no-audit --no-fund
      - run: npm run lint --workspace=frontend
      - run: npm run type-check --workspace=frontend
      - run: npm run build --workspace=frontend
```

Differences from current: drop `defaults:` block, drop OneDrive prefix from both `cache-dependency-path` lines, drop the comment header.

---

## Part C: Build & runtime config audit

### Root `package.json` (= `OneDrive/Desktop/signal-app/package.json`)

There is **no separate** `package.json` at `C:\dev\signal-app\` — the only one is at `OneDrive/Desktop/signal-app/`. After the move it lives at the new repo root.

Path references in this file:
- `"workspaces": ["frontend", "backend"]` — relative to package.json location. **Portable. No edit.**
- All scripts use `--workspace=frontend` / `--workspace=backend`, which npm resolves relative to the workspace package.json's location. **Portable. No edit.**

### `OneDrive/Desktop/signal-app/backend/package.json`

- `"main": "dist/server.js"` — relative. Portable.
- All `"scripts"` use bare commands (`tsc`, `node dist/...`, `ts-node src/...`) executed from the workspace root (`backend/`). Portable.
- The `"build"` script has an inlined Node one-liner that copies `src/db/migrations/*.sql` → `dist/db/migrations/`. Both paths are relative to cwd (= `backend/`). Portable.
- `"db:migrate": "ts-node src/db/migrate.ts"` — relative. Portable.
- `"db:seed": "ts-node src/db/seed.ts"`, `"seed:stories": "ts-node src/scripts/seedStories.ts"`, etc. — all relative. Portable.

### `OneDrive/Desktop/signal-app/frontend/package.json`

All scripts (`next dev`, `next build`, `tsc --noEmit`, `vitest run`) bare. Portable.

### `OneDrive/Desktop/signal-app/backend/tsconfig.json`

- `"outDir": "./dist"`, `"rootDir": "./src"` — relative-to-tsconfig. Portable.
- `"baseUrl": "."`, `"paths": { "@/*": ["src/*"] }` — relative-to-tsconfig. Portable.
- `"include": ["src/**/*.ts"]`, `"exclude": ["node_modules", "dist"]` — relative-to-tsconfig. Portable.

No edits.

### `OneDrive/Desktop/signal-app/frontend/tsconfig.json`

Same shape (`baseUrl: "."`, `paths: {"@/*": ["./src/*"]}`, etc.). Portable. No edits.

### `OneDrive/Desktop/signal-app/backend/jest.config.js`

```js
roots: ["<rootDir>/src", "<rootDir>/tests"],
moduleNameMapper: { "^@/(.*)$": "<rootDir>/src/$1" },
setupFiles: ["<rootDir>/tests/setup.ts"],
```

`<rootDir>` is jest's rootDir token, defaulting to the directory of `jest.config.js`. Portable. No edits.

### `OneDrive/Desktop/signal-app/backend/drizzle.config.ts`

```ts
schema: "./src/db/schema.ts",
out: "./src/db/migrations",
```

Both relative-to-drizzle.config.ts (cwd at invocation time = `backend/`, since `drizzle-kit` is a workspace dep run via npm). Portable. No edits.

### `OneDrive/Desktop/signal-app/frontend/next.config.mjs`

No path refs at all — only optional Sentry wiring keyed on env vars. Portable.

### `OneDrive/Desktop/signal-app/frontend/vitest.config.ts`

```ts
alias: { "@": path.resolve(__dirname, "./src") }
setupFiles: ["./vitest.setup.ts"]
include: ["src/**/*.test.{ts,tsx}"]
```

`__dirname` resolves to whatever directory the config file is in. Portable. No edits.

### `OneDrive/Desktop/signal-app/backend/nodemon.json`

```json
{ "watch": ["src"], "exec": "ts-node src/server.ts", "ignore": ["src/**/*.test.ts", "dist"] }
```

Workspace-relative. Portable.

### `OneDrive/Desktop/signal-app/backend/Dockerfile`

```dockerfile
WORKDIR /app
COPY package.json ./
COPY . .
```

Build context is set Railway-side to the `backend/` directory. After the move, the Railway "Root Directory" setting should be updated from `OneDrive/Desktop/signal-app/backend` → `backend`. **External action — Railway dashboard, not a file edit.** The Dockerfile itself stays unchanged. Same caveat as Vercel.

### `OneDrive/Desktop/signal-app/.gitignore`

All patterns (`node_modules/`, `dist/`, `.env*`, `coverage/`, `docs/sessions/`, etc.) are pattern-relative. No paths that bake in the OneDrive prefix. Will continue to work post-move when relocated to the new repo root.

### Net summary for Part C

**Zero config files require path-string edits.** Everything is workspace-relative, `__dirname`-relative, or pattern-relative. The only "configs" that need a change live outside the repo (Vercel + Railway dashboards).

---

## Part D: Migration runner audit

Source: [`OneDrive/Desktop/signal-app/backend/src/db/migrate.ts`](OneDrive/Desktop/signal-app/backend/src/db/migrate.ts)

### Path-resolution mechanics

Line 194–195:
```ts
const migrationsDir =
  process.env.MIGRATIONS_DIR ?? path.join(__dirname, "migrations");
```

- `__dirname` resolves at runtime to the directory of the executing JS file.
- In dev (`ts-node src/db/migrate.ts`): `__dirname` = `<workspace>/backend/src/db`, so `migrationsDir` = `<workspace>/backend/src/db/migrations`.
- In prod (`node dist/db/migrate.js` after `tsc + sql copy`): `__dirname` = `/app/dist/db` (in container), so `migrationsDir` = `/app/dist/db/migrations`.
- Either way, **the path follows the file**, not any OneDrive-prefixed string.

The `MIGRATIONS_DIR` env-var override exists but is not set anywhere in the repo. Searched: no occurrences of `MIGRATIONS_DIR` outside this one definition. Not used.

### `seed-migration-state.ts`

`backend/src/scripts/seed-migration-state.ts:27`:
```ts
const migrationsDir = path.join(__dirname, "..", "db", "migrations");
```

`__dirname`-relative. Portable. After move, the file is at `backend/src/scripts/seed-migration-state.ts` — `..` still gets you to `src/`, then `db/migrations` — works.

### `drizzle.config.ts` runtime read

Drizzle-kit reads `drizzle.config.ts` from cwd. Per backend/package.json, `db:studio` is the only script invoking drizzle-kit, and npm sets cwd to `backend/` for workspace scripts. Portable.

### Verdict

**The runner works trivially after the move. No path-string fix needed. No subtle issues.**

The runner's other moving parts (advisory lock 8675309, `lfNormalize` + `sha256Hex`, validation rules, BEGIN/COMMIT per migration) are independent of file location. The PR #44 lesson — that the runner has subtle correctness properties around the filename regex — applies to **adding** new migrations, not to moving existing ones. Hashes are content-based; filenames stay identical through `git mv`. The `schema_migrations` table key is the bare filename (`0011_a_create_drizzle_audit_schema.sql`), not a path — moving the parent directory doesn't perturb the lookup.

One paranoia test the planner could choose to add to the stage-2 verification sequence: in the post-move worktree, `npm run db:migrate --workspace=backend -- --dry-run` against a fresh local DB should report all 17 migrations as pending, no validation errors, no hash mismatches. (Not strictly needed since hashes are content-based, but cheap insurance.)

---

## Part E: Script and source path-reference audit

Searched (using Grep tool) for: literal `OneDrive/Desktop/signal-app`, literal `OneDrive\\Desktop\\signal-app`, `__dirname`, `process.cwd`, hardcoded `C:`/`/c/dev`/`\Users\elkha`, `..`-traversing path patterns.

### Grouped results by file

#### `.github/workflows/ci.yml` — **RUNTIME-CRITICAL** (already detailed in Part B)

- L12 (comment), L16 (`working-directory`), L36, L53 (cache paths). 4 lines.

#### `OneDrive/Desktop/signal-app/.claude/settings.local.json` — **RUNTIME-CRITICAL-ish (already broken)**

- L21 — embedded absolute path `C:/Users/elkha/OneDrive/Desktop/signal-app/backend/src/db/migrations/0000_dashing_colleen_wing.sql` inside a Bash permission allow-string. Already stale (per `docs/roadmap/SIGNAL-roadmap.md:32` the working tree is now at `C:\dev\signal-app\…`); no actual command will match this allow-string. Stage 2 should drop this allow entry; CC will re-prompt next time the user runs an `awk` over a migration file.

#### `OneDrive/Desktop/signal-app/backend/src/db/migrate.ts` — **doc-only string + portable code**

- L15 — comment string `// across Windows CRLF / Linux LF / OneDrive auto-conversion.` Doc-only. The reference is to OneDrive's CRLF behavior, not the path prefix. Could leave as-is or refresh in a doc pass.
- L195 — `path.join(__dirname, "migrations")` — portable (see Part D).

#### `OneDrive/Desktop/signal-app/backend/src/scripts/seed-migration-state.ts` — **portable code**

- L27 — `path.join(__dirname, "..", "db", "migrations")`. Portable.

#### `OneDrive/Desktop/signal-app/backend/src/scripts/seedStories.ts` — **portable code**

- L11 — comment "Default file: `<backend>/seed-data/stories.json`". Doc-only.
- L316 — `path.resolve(process.cwd(), "seed-data/stories.json")`. Resolved from cwd. When invoked via `npm run seed:stories --workspace=backend`, npm sets cwd to `backend/`. Portable across the move.

#### `OneDrive/Desktop/signal-app/backend/src/scripts/auditStoryUrls.ts` — **portable code**

- L23 — comment "`backend/seed-data/url-audit-<UTC-YYYY-MM-DD>.txt`". Doc-only.
- L299 — `path.resolve(process.cwd(), "seed-data")`. Same portability story as `seedStories.ts`.

#### `OneDrive/Desktop/signal-app/frontend/vitest.config.ts` — **portable code**

- L16 — `path.resolve(__dirname, "./src")`. Portable.

#### `OneDrive/Desktop/signal-app/README.md` — **DOC-ONLY**

- L70 — table cell: `Frontend | Vercel | Root = \`OneDrive/Desktop/signal-app/frontend\`.` After the move, this reads "Root = `frontend`." (Doc edit.) **Note:** the description doc-changes, but the underlying Vercel project setting must also change in the dashboard — call this out separately in the follow-up doc PR or as an "external action" item.

#### `OneDrive/Desktop/signal-app/CLAUDE.md` — **DOC-ONLY**

- L45 — code-block heading: ` OneDrive/Desktop/signal-app/`
- L48 — prose: "git ls-tree confirms every path starts with `OneDrive/Desktop/signal-app/`."
- L53 — prose: "When you `cd backend`, you're at `OneDrive/Desktop/signal-app/backend`."
- L682–L686 — workspace topology section, references `C:\Users\elkha\OneDrive\…`, `sa-imr\`, `home-dir-as-repo` etc.
- L761 — "deferred infra" callout for `flatten the OneDrive path prefix (#18)`.

The whole §2 ("REPO PATH QUIRK") becomes obsolete post-move; rewrite or delete in the follow-up doc PR. §15 "Workspace topology" needs a refresh too (also covers the partially-stale primary-worktree claim noted in Bug flags).

#### `OneDrive/Desktop/signal-app/docs/PHASE_9_CLOSEOUT.md` — **DOC-ONLY (closeout)**

- L178 — "instead of `C:\Users\elkha\` …"
- L185 — "tracked paths still carry the `OneDrive/Desktop/signal-app/` …"
- L221 — `#18 — Flatten OneDrive/Desktop/signal-app/ path prefix (NEW).`
- L295, L297, L299 — workspace fallback paths.

PHASE_9_CLOSEOUT is a historical document. Best practice: leave the historical text as-is (it accurately records what state was at closeout); add a brief "superseded by stage-1 restructure on 2026-04-27" callout if desired. Doc-only either way.

#### `OneDrive/Desktop/signal-app/docs/roadmap/SIGNAL-roadmap.md` — **DOC-ONLY**

- L22, L32, L158, L160, L514 — multiple OneDrive references. Some are about the historical layout, some are about pending cleanup ("OneDrive path remnants"). Update in follow-up doc PR; some of the "cleanup pending" statements will become "done" after the move.

#### `OneDrive/Desktop/signal-app/docs/ROADMAP.md` — **DOC-ONLY**

- L55 — `P3 #18 — Flatten OneDrive/Desktop/signal-app/ path prefix`. After stage 2 ships, move this from "Infrastructure / ops hygiene" to a closeout doc; or strike it.
- L101 — "Path prefixes in tracked files compound." General principle — fine to keep; rephrase to past-tense if desired.

### Files that did NOT match anything path-relevant

- All `backend/src/{controllers,services,routes,middleware,jobs,emails,lib,utils}/*.ts` — no OneDrive refs, no cwd/dirname path manipulation (sentry.ts uses env vars only).
- All `backend/tests/*.test.ts` — no OneDrive refs, no fixture-loading-by-path. Mock-DB pattern, no filesystem use.
- All `frontend/src/**/*` — no OneDrive refs; standard app-router code.
- `backend/src/db/{schema.ts,index.ts,seed.ts,verify.ts,helpers.ts}` — no path strings.
- All migration `.sql` files — no path refs (they're SQL).
- `package-lock.json` at root — auto-generated, no manual paths.
- `frontend/sentry.{client,server,edge}.config.ts`, `next.config.mjs` — no path strings.
- `backend/Dockerfile` — context-relative `COPY` only.

---

## Part F: Test fixture and seed data audit

### `backend/tests/setup.ts`

Sets env vars for the test process. **Zero path references.** Portable.

### `backend/tests/helpers/mockDb.ts`

Pure mock-builder for Drizzle's chained query interface. Zero filesystem access, zero paths. Portable.

### `backend/tests/fixtures/`

**Does not exist.** No fixture directory under `backend/tests/`. Tests stage data via `mock.queueSelect([...])` etc.

### `backend/seed-data/`

Contains `stories.json` (the curated content seed) and `url-audit-2026-04-24.txt`. These are read by `seedStories.ts` and `auditStoryUrls.ts` respectively, both via `process.cwd()`-relative resolution and both invoked via npm workspace scripts whose cwd is `backend/`. Portable.

### Verdict

**No test or fixture path needs to change.** Move-trivially.

---

## Part G: Claude Code config audit

### `OneDrive/Desktop/signal-app/.claude/settings.local.json`

Full content reproduced here for the planner's convenience:
```json
{
  "permissions": {
    "allow": [
      "Bash(npm --version)",
      "Bash(cmd.exe //c \"where node && where npm\")",
      "Bash(cmd.exe //c \"where node\")",
      "Bash(cmd.exe //c \"where npm\")",
      "Bash(cmd.exe //c \"echo %PATH%\")",
      "Bash(powershell.exe -NoProfile -Command \"Get-Command node | Select-Object -ExpandProperty Source; Get-Command npm | Select-Object -ExpandProperty Source\")",
      "Bash(export PATH=\"/c/Program Files/nodejs:$PATH\")",
      "Bash(npm install *)",
      "Bash(npm run *)",
      "Bash(curl -s -o /dev/null -w \"HTTP %{http_code}\\\\n\" http://localhost:3001/health)",
      "Bash(curl -s http://localhost:3001/health)",
      "Bash(curl -s -o /dev/null -w \"HTTP %{http_code}\\\\n\" http://localhost:3000/)",
      "Bash(curl -s http://localhost:3000/)",
      "Bash(powershell.exe -NoProfile -Command 'try { $c = New-Object System.Net.Sockets.TcpClient\\('\\\\''localhost'\\\\'', 5432\\); $c.Close\\(\\); '\\\\''PG_REACHABLE'\\\\'' } catch { '\\\\''PG_NOT_REACHABLE'\\\\'' }')",
      "Bash(powershell.exe -NoProfile -Command \"Get-Service -Name '*postgres*' -ErrorAction SilentlyContinue | Select-Object Name,Status\")",
      "Bash(cmd.exe //c \"where psql\")",
      "Bash(cmd.exe //c \"where docker\")",
      "Bash(awk 'tolower\\($0\\) ~ /\\(add constraint|references|unique\\)/ {print NR\": \"$0}' \"C:/Users/elkha/OneDrive/Desktop/signal-app/backend/src/db/migrations/0000_dashing_colleen_wing.sql\")",
      "Bash(npx ts-node *)",
      "Bash(grep -v -E \"SECURITY WARNING|SSL modes|In the next major|To prepare|explicitly use|libpq compatibility|postgresql.org|Use .node --trace|^$\")"
    ]
  }
}
```

**Path-relevant entries:**
- L21 — the awk-over-`0000_dashing_colleen_wing.sql` rule — the only line with a baked-in absolute path. Already stale (see Bug flags). **Recommend removing in stage 2.**

All other allows are either bare commands (`npm run *`), localhost curls, or process inspection — path-agnostic.

### `OneDrive/Desktop/signal-app/.claude/settings.json`

**Does not exist.** Only `settings.local.json`.

### Other `.claude/` content

`.claude/worktrees/` contains the leftover gitlink (Bug flags) and this audit's worktree directory. Nothing else.

### `CLAUDE.md`

Path-affected sections:
- §2 (entire section) — the "REPO PATH QUIRK" warning is the load-bearing prose that should be **deleted** post-move. Does not become a runtime issue if left, but actively misleads future agents.
- §15 — "Workspace topology" + "Worktree hygiene" — references stale paths (`signal-app-12c\`, `sa-imr\`, home-dir-as-repo). Refresh in follow-up doc PR.
- §16 — "Deferred infra" final paragraph names "flatten the OneDrive path prefix (#18)" — to be moved to a closeout doc.
- §4 — monorepo layout block opens with `signal-app/` as the new logical root; current text is correct after the move (it never mentions the OneDrive prefix in the tree diagram; just does so in §2 commentary).

All §-level edits to CLAUDE.md are doc-only.

---

## Part H: Cross-cutting observations

- **Pre-existing bug discovered (the gitlink at `vibrant-carson-3c3be9`)** — see Bug flags. Strongest reason to do a hygiene commit in stage 2 before the `git mv`.
- **Unintended worktree-tracking pattern.** The `.claude/worktrees/<slug>/` paths are CC's normal worktree spawn location and should not be tracked. Consider adding `OneDrive/Desktop/signal-app/.claude/worktrees/` (or post-move `.claude/worktrees/`) to `.gitignore` in the same hygiene commit. Currently the only "tracked" entry under that path is the bogus gitlink; once removed, ignoring the parent directory prevents recurrence.
- **Stale CLAUDE.md sections (§4 migrations list, §15 workspace topology).** Not blockers for the restructure, but worth a follow-up doc-refresh PR after the move so future agents don't act on stale info.
- **Script naming inconsistency:** the prompt's stage-2 gates list `npm run typecheck`. Actual scripts are named `type-check` (with hyphen) in `backend/package.json:12` and `frontend/package.json:10`. CI uses the hyphen. **Stage 2 must use `type-check`**, not `typecheck`.
- **No `defensive "either nested or flat" code anywhere.** Searched for paths with both forms; found none. The codebase is consistently written for one layout (the nested one) — confirms there's no half-finished previous restructure attempt.
- **TODO/FIXME inventory** in `backend/src/`: only one hit, [`backend/src/services/commentaryService.ts:72`](OneDrive/Desktop/signal-app/backend/src/services/commentaryService.ts:72) — about `last_accessed_at` write throttling, unrelated to paths. No `@ts-ignore` / `@ts-expect-error` in source.
- **Vercel + Railway external actions are necessary** — flagged at TL;DR #4 and Part C. The user must update both dashboards after the move, otherwise:
  - Vercel will look for `OneDrive/Desktop/signal-app/frontend/package.json` and fail to build.
  - Railway will look for `OneDrive/Desktop/signal-app/backend/Dockerfile` and fail to build.
  Stage 2 should explicitly include these as items in the merge checklist before merging the PR to `main`. Both can be flipped in the dashboard the moment the PR is opened (they're per-branch settings — preview deploys can be tested on the PR branch first).

---

## Stage 2 work plan recommendation

### Pre-move hygiene commit (recommended)

In the same PR, **before** the `git mv`, land:

1. `git rm OneDrive/Desktop/signal-app/.claude/worktrees/vibrant-carson-3c3be9` (drops the stale gitlink — Bug flag #1).
2. Add `.claude/worktrees/` to `.gitignore` (post-edit; do this after the `git mv` in the new `.gitignore` location to be safe — see ordering note below).

This is optional — the move works without it — but it's cheap and removes the noise.

### Mass `git mv` operation

```bash
# From the working tree root (after the move, this becomes "the new repo root")
git mv OneDrive/Desktop/signal-app/.gitignore .gitignore
git mv OneDrive/Desktop/signal-app/CLAUDE.md CLAUDE.md
git mv OneDrive/Desktop/signal-app/README.md README.md
git mv OneDrive/Desktop/signal-app/package.json package.json
git mv OneDrive/Desktop/signal-app/package-lock.json package-lock.json
git mv OneDrive/Desktop/signal-app/.claude .claude
git mv OneDrive/Desktop/signal-app/backend backend
git mv OneDrive/Desktop/signal-app/docs docs
git mv OneDrive/Desktop/signal-app/frontend frontend
# OneDrive/Desktop/ and OneDrive/ are now empty; rmdir them
rmdir OneDrive/Desktop OneDrive
```

Notes:
- **`.gitignore` first.** Moving it first means the new `.gitignore` is in effect for the rest of the move (matters if you also add the `.claude/worktrees/` ignore in this PR).
- `git mv` on a directory rewrites the index for every file under that directory atomically. Doing the four large dirs (`.claude`, `backend`, `docs`, `frontend`) as four separate `git mv` invocations gives a cleaner diff in the PR ("renamed: …") than `git mv OneDrive .` would.
- The `OneDrive/Desktop/signal-app/.claude/worktrees/zealous-lumiere-45dbae` worktree path is _unrelated_ to the tracked-content move; it lives in the worktree's own filesystem, not in the index. Stage 2 won't be running inside this worktree anyway — it'll be a fresh session in a new worktree spawned off `restructure/flatten-onedrive-nesting`.
- **The other worktree at `C:/dev/signal-app` (on `main`)** will need to be reset/checked-out post-merge so its on-disk view reflects the new layout. Standard worktree-update operation; not a stage-2 concern.

### Post-move runtime-critical edits (one commit, with the move or right after)

1. **`.github/workflows/ci.yml`** — apply the rewrite from Part B. Drop the `defaults:` block, drop the OneDrive prefix from both `cache-dependency-path` lines, drop the comment header.
2. **`.claude/settings.local.json`** — delete the L21 awk-with-stale-path entry.

That's the entirety of the runtime-critical surface. **Two files touched.**

### Deferred to follow-up doc PR

- **`README.md:70`** — Vercel project root description.
- **`CLAUDE.md`** — delete §2 ("REPO PATH QUIRK"); refresh §15 workspace topology; remove §16 deferred-infra `#18` line; bring §4 migration list up to date through `0015`.
- **`docs/ROADMAP.md:55, 101`** — strike or move to closeout the `#18` line; past-tense the L101 principle.
- **`docs/roadmap/SIGNAL-roadmap.md:22, 32, 158, 160, 514`** — update OneDrive references to past tense / "completed".
- **`docs/PHASE_9_CLOSEOUT.md`** — leave historical text alone; optional brief note that #18 is now closed.

### External actions (manual, must be done before merge)

1. **Vercel dashboard** — Project Settings → General → Root Directory: `OneDrive/Desktop/signal-app/frontend` → `frontend`. Test on the PR's preview build first (Vercel auto-builds the PR with the new setting once changed).
2. **Railway dashboard** — Service Settings → Service → Root Directory: `OneDrive/Desktop/signal-app/backend` → `backend`. Verify a deploy from the PR branch succeeds before merging to `main`.

### Verification sequence (stage 2 pre-PR gates)

Run from the new repo root after the move + edits:

1. `npm install` — re-resolve workspaces. Should be a no-op or near-no-op (no dep changes), but the lockfile must agree on the workspace-relative paths.
2. `npm run lint --workspace=backend && npm run lint --workspace=frontend`
3. `npm run type-check --workspace=backend && npm run type-check --workspace=frontend` *(use the hyphenated name — see "Cross-cutting observations")*
4. `npm test --workspace=backend && npm test --workspace=frontend`
5. (Optional but recommended) `npm run db:migrate --workspace=backend -- --dry-run` against a fresh local Postgres — proves the migration runner finds files at its new dist location.
6. CI must pass on the PR (the workflow edit is what unblocks this — without the edit, CI breaks immediately).

Dev-server startup is manual per the prompt; not a gate.

---

## Open questions for the next planner session

1. **Should the gitlink hygiene happen in the same PR or its own PR?** Tactically, same-PR keeps everything in one diff; but a one-line "remove stale gitlink" PR is also defensible and would land before the move. Recommendation: same PR, as the first commit in the PR's history (so the move is clean against a clean tree).
2. **`.claude/worktrees/` in `.gitignore`?** Cheap, defends against recurrence of the gitlink mistake. But touching `.gitignore` in a structural-move PR adds noise. Defer to user judgment.
3. **Doc-PR sequencing.** The prompt explicitly says doc updates ship as a follow-up PR. Suggest the planner sketch that follow-up PR's diff in stage 2's prompt-writing pass so it's ready to ship the moment stage 2's PR merges.
4. **CLAUDE.md §15 stale primary-worktree claim** — out of scope for the restructure but the same doc-refresh PR could fix it. Worth flagging to the user.
5. **Did PR #42 actually create a `docs/workflow/` directory?** Prompt assumed yes; nothing exists on disk. Confirm via `gh pr view 42 --json files` before stage 2 starts, in case there's a tracked doc the planner should know about.
6. **Two-worktrees-on-`main` risk.** `git worktree list` shows `C:/dev/signal-app` is currently on `main`. When stage 2 spawns its worktree off `restructure/flatten-onedrive-nesting`, no conflict. But if anyone tries to also create a worktree on `main` at the same time, git rejects it. Not a stage-2 problem; just an environmental note for the user.

---

## Appendix: Full path-reference inventory

Format: `file:line` — context.

### Literal `OneDrive/Desktop/signal-app` hits (from Grep `OneDrive` across repo)

```
.github/workflows/ci.yml:12   # The tracked code lives in OneDrive/Desktop/signal-app/ (historical layout).
.github/workflows/ci.yml:16       working-directory: OneDrive/Desktop/signal-app
.github/workflows/ci.yml:36           cache-dependency-path: OneDrive/Desktop/signal-app/package-lock.json
.github/workflows/ci.yml:53           cache-dependency-path: OneDrive/Desktop/signal-app/package-lock.json

OneDrive/Desktop/signal-app/README.md:70                | Frontend  | Vercel  | Root = `OneDrive/Desktop/signal-app/frontend`. |

OneDrive/Desktop/signal-app/CLAUDE.md:45    OneDrive/Desktop/signal-app/
OneDrive/Desktop/signal-app/CLAUDE.md:48    …inside the repo root. … `git ls-tree …` confirms every path starts with `OneDrive/Desktop/signal-app/` …
OneDrive/Desktop/signal-app/CLAUDE.md:53    3. When you `cd backend`, you're at `OneDrive/Desktop/signal-app/backend`, not the worktree root.
OneDrive/Desktop/signal-app/CLAUDE.md:682   `C:\Users\elkha\OneDrive\Desktop\signal-app-12c\`
OneDrive/Desktop/signal-app/CLAUDE.md:683   `C:\Users\elkha\OneDrive\Desktop\sa-imr\`
OneDrive/Desktop/signal-app/CLAUDE.md:686   `C:\Users\elkha\.git\` … OneDrive-prefixed paths …
OneDrive/Desktop/signal-app/CLAUDE.md:761   … flatten the OneDrive path prefix (#18) …

OneDrive/Desktop/signal-app/.claude/settings.local.json:21   "Bash(awk … \"C:/Users/elkha/OneDrive/Desktop/signal-app/backend/src/db/migrations/0000_dashing_colleen_wing.sql\")",

OneDrive/Desktop/signal-app/docs/PHASE_9_CLOSEOUT.md:185     - **Partial:** tracked paths still carry the `OneDrive/Desktop/signal-app/`
OneDrive/Desktop/signal-app/docs/PHASE_9_CLOSEOUT.md:221     - **#18 — Flatten `OneDrive/Desktop/signal-app/` path prefix (NEW).**
OneDrive/Desktop/signal-app/docs/PHASE_9_CLOSEOUT.md:295     Code itself lives at `C:\dev\signal-app\OneDrive\Desktop\signal-app\{backend,frontend}\`
OneDrive/Desktop/signal-app/docs/PHASE_9_CLOSEOUT.md:297     - Fallback repo: `C:\Users\elkha\OneDrive\Desktop\signal-app\` kept as a

OneDrive/Desktop/signal-app/docs/roadmap/SIGNAL-roadmap.md:22   [long line, OneDrive ref]
OneDrive/Desktop/signal-app/docs/roadmap/SIGNAL-roadmap.md:32   Working tree at `C:\dev\signal-app\OneDrive\Desktop\signal-app\` …
OneDrive/Desktop/signal-app/docs/roadmap/SIGNAL-roadmap.md:158  Two distinct jobs … OneDrive flatten + home-dir-repo cleanup …
OneDrive/Desktop/signal-app/docs/roadmap/SIGNAL-roadmap.md:160  Outstanding cosmetic followups: old OneDrive paths …
OneDrive/Desktop/signal-app/docs/roadmap/SIGNAL-roadmap.md:514  - **OneDrive path remnants** — …

OneDrive/Desktop/signal-app/docs/ROADMAP.md:55    - **P3 #18 — Flatten `OneDrive/Desktop/signal-app/` path prefix** out of tracked paths. …
OneDrive/Desktop/signal-app/docs/ROADMAP.md:101   - **Path prefixes in tracked files compound.** The `OneDrive/Desktop/signal-app/` legacy prefix …

OneDrive/Desktop/signal-app/backend/src/db/migrate.ts:15   // across Windows CRLF / Linux LF / OneDrive auto-conversion.
```

### `__dirname` / `process.cwd()` hits (path-resolution mechanics)

```
OneDrive/Desktop/signal-app/backend/src/db/migrate.ts:195             path.join(__dirname, "migrations")
OneDrive/Desktop/signal-app/backend/src/scripts/seed-migration-state.ts:27   path.join(__dirname, "..", "db", "migrations")
OneDrive/Desktop/signal-app/backend/src/scripts/seedStories.ts:316    path.resolve(process.cwd(), "seed-data/stories.json")
OneDrive/Desktop/signal-app/backend/src/scripts/auditStoryUrls.ts:299  path.resolve(process.cwd(), "seed-data")
OneDrive/Desktop/signal-app/frontend/vitest.config.ts:16              path.resolve(__dirname, "./src")
```

All five resolve correctly post-move (see Part D for the full analysis).

### Hardcoded `C:` absolute paths

Only one in tracked code (everything else is in markdown prose):

```
OneDrive/Desktop/signal-app/.claude/settings.local.json:21   C:/Users/elkha/OneDrive/Desktop/signal-app/backend/src/db/migrations/0000_dashing_colleen_wing.sql
```

(Already stale; flag in Bug flags.)
