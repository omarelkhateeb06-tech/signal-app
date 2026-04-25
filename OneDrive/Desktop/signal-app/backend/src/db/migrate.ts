import "dotenv/config";
import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { Pool, type PoolClient } from "pg";

// Homegrown migration runner. Replaces drizzle-kit migrate. Drizzle ORM
// stays for runtime queries; this file only handles schema migrations.
//
// Tracking table: `schema_migrations` (filename, content_hash, applied_at,
// applied_by). The DDL is exported as SCHEMA_MIGRATIONS_DDL — single source
// of truth, also used by the seed-printer.
//
// Hash: SHA-256 over LF-normalized + BOM-stripped UTF-8 file bytes — stable
// across Windows CRLF / Linux LF / OneDrive auto-conversion.
//
// Concurrency: pg_advisory_lock(8675309) gates the whole run so two
// containers booting in parallel can't double-apply.
//
// Atomicity: each migration runs inside its own BEGIN/COMMIT; the INSERT
// into schema_migrations is in the same transaction as the migration SQL,
// so a partial apply leaves no row.
//
// Failure modes (all hard errors with recovery hint):
//   - content_hash mismatch on a previously-applied migration
//   - applied row points to a migration file that no longer exists
//
// Folder resolution: sibling `migrations/` (dist/db/migrations/ at runtime),
// override via MIGRATIONS_DIR env.

const ADVISORY_LOCK_KEY = 8675309;
const MIGRATION_FILENAME_REGEX = /^\d{4}_.*\.sql$/;

export const SCHEMA_MIGRATIONS_TABLE = "schema_migrations";

export const SCHEMA_MIGRATIONS_DDL = `CREATE TABLE IF NOT EXISTS ${SCHEMA_MIGRATIONS_TABLE} (
  filename TEXT PRIMARY KEY,
  content_hash TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_by TEXT
)`;

interface CliFlags {
  dryRun: boolean;
}

interface MigrationFile {
  filename: string;
  fullPath: string;
  contents: string;
  contentHash: string;
}

interface AppliedRow {
  filename: string;
  contentHash: string;
  appliedAt: Date;
  appliedBy: string | null;
}

function parseFlags(argv: readonly string[]): CliFlags {
  return { dryRun: argv.includes("--dry-run") };
}

function log(msg: string): void {
  console.log(`[migrate] ${msg}`);
}

function err(msg: string): void {
  console.error(`[migrate] ${msg}`);
}

export function lfNormalize(buf: Buffer): string {
  let s = buf.toString("utf8");
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  return s.replace(/\r\n/g, "\n");
}

export function sha256Hex(s: string): string {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

async function listMigrationFiles(dir: string): Promise<MigrationFile[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const sqlFiles = entries
    .filter((e) => e.isFile() && MIGRATION_FILENAME_REGEX.test(e.name))
    .map((e) => e.name)
    .sort();

  const files: MigrationFile[] = [];
  for (const filename of sqlFiles) {
    const fullPath = path.join(dir, filename);
    const buf = await fs.readFile(fullPath);
    const contents = lfNormalize(buf);
    const contentHash = sha256Hex(contents);
    files.push({ filename, fullPath, contents, contentHash });
  }
  return files;
}

async function tableExists(client: PoolClient, name: string): Promise<boolean> {
  const r = await client.query<{ exists: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = $1) AS exists",
    [name]
  );
  return r.rows[0]?.exists ?? false;
}

async function ensureTable(client: PoolClient): Promise<void> {
  await client.query(SCHEMA_MIGRATIONS_DDL);
}

async function readApplied(client: PoolClient): Promise<AppliedRow[]> {
  const r = await client.query<{
    filename: string;
    content_hash: string;
    applied_at: Date;
    applied_by: string | null;
  }>(
    `SELECT filename, content_hash, applied_at, applied_by FROM ${SCHEMA_MIGRATIONS_TABLE} ORDER BY filename ASC`
  );
  return r.rows.map((row) => ({
    filename: row.filename,
    contentHash: row.content_hash,
    appliedAt: row.applied_at,
    appliedBy: row.applied_by,
  }));
}

function whoApplied(): string | null {
  return (
    process.env.GIT_COMMIT_SHA ??
    process.env.USER ??
    process.env.USERNAME ??
    null
  );
}

interface ValidationOk {
  ok: true;
  pending: MigrationFile[];
}
interface ValidationFail {
  ok: false;
  errors: string[];
}

function validate(files: MigrationFile[], applied: AppliedRow[]): ValidationOk | ValidationFail {
  const errors: string[] = [];
  const fileByName = new Map(files.map((f) => [f.filename, f]));
  const appliedByName = new Map(applied.map((a) => [a.filename, a]));

  for (const a of applied) {
    const f = fileByName.get(a.filename);
    if (!f) {
      errors.push(
        `applied migration "${a.filename}" (applied_at=${a.appliedAt.toISOString()}, applied_by=${a.appliedBy ?? "null"}) has no corresponding file on disk. Recovery: restore the file from git history or, if intentionally removed, DELETE the row from ${SCHEMA_MIGRATIONS_TABLE} after confirming the schema state.`
      );
      continue;
    }
    if (f.contentHash !== a.contentHash) {
      errors.push(
        `content_hash mismatch for "${a.filename}": disk=${f.contentHash} db=${a.contentHash} (applied_at=${a.appliedAt.toISOString()}, applied_by=${a.appliedBy ?? "null"}). Recovery: revert the file edit (migrations are immutable once applied), or if the edit is intentional, manually UPDATE ${SCHEMA_MIGRATIONS_TABLE}.content_hash after confirming the change is a no-op against current schema.`
      );
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  const pending = files.filter((f) => !appliedByName.has(f.filename));
  return { ok: true, pending };
}

async function applyOne(client: PoolClient, file: MigrationFile, appliedBy: string | null): Promise<void> {
  await client.query("BEGIN");
  try {
    await client.query(file.contents);
    await client.query(
      `INSERT INTO ${SCHEMA_MIGRATIONS_TABLE} (filename, content_hash, applied_at, applied_by) VALUES ($1, $2, now(), $3)`,
      [file.filename, file.contentHash, appliedBy]
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  }
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");

  const migrationsDir =
    process.env.MIGRATIONS_DIR ?? path.join(__dirname, "migrations");
  log(`migrations dir: ${migrationsDir}`);
  if (flags.dryRun) log("DRY RUN — no writes will occur");

  const pool = new Pool({
    connectionString,
    ssl: connectionString.includes("sslmode=require")
      ? { rejectUnauthorized: false }
      : undefined,
    max: 1,
  });

  const started = Date.now();
  const client = await pool.connect();
  let lockHeld = false;
  try {
    log("acquiring advisory lock (blocks if another migrator is active)…");
    await client.query("SELECT pg_advisory_lock($1)", [ADVISORY_LOCK_KEY]);
    lockHeld = true;
    log("lock acquired");

    const files = await listMigrationFiles(migrationsDir);
    log(`found ${files.length} migration file(s) on disk`);

    if (flags.dryRun) {
      const exists = await tableExists(client, SCHEMA_MIGRATIONS_TABLE);
      if (!exists) {
        log(`dry-run: ${SCHEMA_MIGRATIONS_TABLE} does not exist; would create on real run`);
        log(`dry-run: ${files.length} migration(s) would be pending`);
        for (const f of files) log(`  pending: ${f.filename}`);
        return;
      }
      const applied = await readApplied(client);
      const result = validate(files, applied);
      if (!result.ok) {
        for (const e of result.errors) err(e);
        throw new Error("dry-run validation failed; see errors above");
      }
      log(`dry-run: ${applied.length} applied, ${result.pending.length} pending`);
      for (const f of result.pending) log(`  pending: ${f.filename}`);
      return;
    }

    await ensureTable(client);
    const applied = await readApplied(client);
    const result = validate(files, applied);
    if (!result.ok) {
      for (const e of result.errors) err(e);
      throw new Error("validation failed; see errors above");
    }

    if (result.pending.length === 0) {
      log(`up to date (${applied.length} applied, 0 pending)`);
      return;
    }

    const appliedBy = whoApplied();
    log(`applying ${result.pending.length} migration(s) as ${appliedBy ?? "anonymous"}`);
    for (const f of result.pending) {
      const t0 = Date.now();
      log(`applying ${f.filename}…`);
      await applyOne(client, f, appliedBy);
      log(`  ✓ ${f.filename} (${Date.now() - t0}ms)`);
    }
    log(`done — ${result.pending.length} applied in ${Date.now() - started}ms`);
  } finally {
    if (lockHeld) {
      await client
        .query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY])
        .catch((e) =>
          err(
            `warning: failed to release advisory lock: ${(e as Error).message} (session-end will reclaim)`
          )
        );
    }
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((e) => {
    err(`failed: ${(e as Error).message}`);
    process.exit(1);
  });
}
