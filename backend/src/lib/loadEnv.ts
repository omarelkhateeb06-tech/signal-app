// Issue #53 — CLI env loader, override edition.
//
// `import "dotenv/config"` does NOT override variables already present in the
// process environment. An empty exported `ANTHROPIC_API_KEY=""` in the shell
// (a stale `.env.example` source, a PowerShell `$PROFILE`, or Windows
// Credential Manager) silently shadows the real key in `backend/.env` with no
// error and no startup-check failure — length checks see "" as "present", so
// both empty-string and real-string register the same. Symptom: scripts fail
// with auth errors despite a valid `.env`. It cost the 12e.5b smoke ~8 rounds
// of debugging (see CLAUDE.md §12).
//
// CLI scripts import THIS module instead of "dotenv/config" so the `.env`
// file's values win over a shadowing shell env. `override: true` is correct
// for CLI tools (the developer's `.env` is the intended source of truth);
// it is deliberately NOT used by `server.ts` or `db/index.ts`, where the
// process environment (Railway, systemd, etc.) must remain authoritative.
//
// Import-ordering contract: this is a SIDE-EFFECT module — importing it runs
// `dotenv.config({ override: true })` immediately. It MUST be the first import
// in every CLI entrypoint, ahead of any module that reads `process.env` at
// evaluation time (notably `../db`, which builds its pg Pool from
// `DATABASE_URL`). Replacing the pre-existing first-line `import "dotenv/config"`
// in place preserves that ordering, since that import already had to load the
// environment before `../db` for the same reason.
//
// In production there is no `.env` file in the image (gitignored, never
// COPYed), so `override: true` is a no-op there and the Railway-provided
// environment stands unchanged.
import * as dotenv from "dotenv";

dotenv.config({ override: true });
