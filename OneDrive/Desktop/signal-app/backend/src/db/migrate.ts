import "dotenv/config";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

// Runs pending Drizzle migrations and exits. Wired into the container CMD
// ahead of the server process so a failed migration fail-fasts and the
// new container never becomes live — Railway keeps the previous healthy
// container serving traffic. Idempotent: Drizzle tracks applied migrations
// in `__drizzle_migrations`, so re-running on every deploy is a no-op once
// up to date.
//
// Migrations folder resolution:
//   - Default: sibling `migrations/` directory relative to this compiled
//     file (dist/db/migrations/ at runtime — populated by the build step).
//   - Override: `DRIZZLE_MIGRATIONS_DIR` env var for ad-hoc runs against
//     source SQL files without rebuilding.
async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }

  const migrationsFolder =
    process.env.DRIZZLE_MIGRATIONS_DIR ?? path.join(__dirname, "migrations");

  const pool = new Pool({
    connectionString,
    ssl: connectionString.includes("sslmode=require")
      ? { rejectUnauthorized: false }
      : undefined,
    max: 1,
  });

  const db = drizzle(pool);

  const started = Date.now();
  console.log(`[migrate] running migrations from ${migrationsFolder}`);
  try {
    await migrate(db, { migrationsFolder });
    const elapsed = Date.now() - started;
    console.log(`[migrate] done in ${elapsed}ms`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[migrate] failed:", err);
  process.exit(1);
});
