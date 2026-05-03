// Debug: call computeEmbedding directly on one published candidate.
// Reports {ok, rejectionReason or first 5 dims} so we can isolate
// whether the embedding stage was failing soft, or whether the persist
// step was the issue.

import "dotenv/config";

import { eq } from "drizzle-orm";

import { db, pool } from "../db";
import { ingestionCandidates } from "../db/schema";
import { computeEmbedding } from "../jobs/ingestion/embeddingSeam";
import { getOpenAIClient } from "../lib/openaiClient";

async function main(): Promise<void> {
  const openai = getOpenAIClient();
  console.log(`openai client: ${openai === null ? "NULL" : "present"}`);
  console.log(`OPENAI_API_KEY in process.env: ${process.env.OPENAI_API_KEY ? "yes (len=" + process.env.OPENAI_API_KEY.length + ")" : "no"}`);

  const rows = await db
    .select({ id: ingestionCandidates.id, title: ingestionCandidates.rawTitle })
    .from(ingestionCandidates)
    .where(eq(ingestionCandidates.status, "published"))
    .limit(1);
  if (!rows[0]) { console.log("no published candidate"); process.exit(1); }
  const id = rows[0].id;
  console.log(`target candidate: ${id} (${rows[0].title?.slice(0, 60)})`);

  const result = await computeEmbedding(id, { db, openai });
  if (result.ok) {
    console.log(`embedding OK; first 5 dims: ${result.embedding.slice(0, 5).join(",")}; total dims: ${result.embedding.length}`);

    // Try to persist it
    try {
      await db
        .update(ingestionCandidates)
        .set({ embedding: result.embedding })
        .where(eq(ingestionCandidates.id, id));
      console.log("persist OK");
      // Verify
      const check = await db.execute({
        sql: `SELECT embedding IS NULL AS is_null FROM ingestion_candidates WHERE id = $1`,
        args: [id],
      } as never);
      console.log("re-read:", JSON.stringify((check as { rows: unknown[] }).rows ?? check));
    } catch (err) {
      console.log("persist ERROR:", (err as Error).message);
      console.log((err as Error).stack);
    }
  } else {
    console.log(`embedding FAIL: rejection=${result.rejectionReason}; error=${String(result.error)}`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
