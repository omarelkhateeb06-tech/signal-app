import "dotenv/config";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required");
}

export const pool = new Pool({
  connectionString,
  ssl: connectionString.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined,
  max: 10,
});

// Pool-level errors (e.g. an idle client's TCP connection dying) are emitted
// on the Pool, not the query promise. Without a listener they become
// unhandledRejection and crash the process. Log and move on — in-flight
// queries still reject with the same error via their own promises and the
// Express errorHandler coerces pg failure codes to a 503.
pool.on("error", (err: Error) => {
  // eslint-disable-next-line no-console
  console.error("[db:pool] idle client error", err);
});

export const db: NodePgDatabase<typeof schema> = drizzle(pool, { schema });

export { schema };
