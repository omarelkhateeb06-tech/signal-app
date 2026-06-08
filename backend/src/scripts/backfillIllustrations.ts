// Phase C — backfill illustration_url for existing native events.
//
// Queries every published native event that has no illustration_url, then
// calls the illustration service for each one. Requires RECRAFT_API_KEY and
// DATABASE_URL. Safe to re-run — skips rows that already have a URL.
//
// Usage:
//   npm run backfill-illustrations --workspace=backend
//   npm run backfill-illustrations --workspace=backend -- --dry-run
//   npm run backfill-illustrations --workspace=backend -- --limit=10

import "../lib/loadEnv";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { events, ingestionSources, eventSources } from "../db/schema";
import {
  generateAndStoreIllustration,
  resolveArchetype,
} from "../services/illustrationService";

const isDryRun = process.argv.includes("--dry-run");
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const limit = limitArg ? parseInt(limitArg.split("=")[1] ?? "50", 10) : 50;

async function main(): Promise<void> {
  // Dry-run only lists pending events (no image generation), so it doesn't
  // need the key — this lets the scheduled membership-MCP flow enumerate work
  // without the backend API key set. Live mode still requires it.
  if (!isDryRun && !process.env.HIGGSFIELD_API_KEY) {
    console.error("HIGGSFIELD_API_KEY is not set. Aborting.");
    process.exit(1);
  }

  console.log(`[backfillIllustrations] mode=${isDryRun ? "dry-run" : "live"} limit=${limit}`);

  // Find native events without an illustration, joined to their primary source
  // so we can resolve the generator slug → archetype.
  const rows = await db
    .select({
      eventId: events.id,
      headline: events.headline,
      sourceSlug: ingestionSources.slug,
    })
    .from(events)
    .innerJoin(eventSources, eq(eventSources.eventId, events.id))
    .innerJoin(ingestionSources, eq(ingestionSources.id, eventSources.ingestionSourceId))
    .where(
      and(
        eq(events.sourceType, "native"),
        eq(eventSources.role, "primary"),
        isNull(events.illustrationUrl),
      ),
    )
    .limit(limit);

  if (rows.length === 0) {
    console.log("[backfillIllustrations] No native events need backfilling.");
    return;
  }

  console.log(`[backfillIllustrations] Found ${rows.length} events to illustrate.`);

  let ok = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    const archetype = resolveArchetype(row.sourceSlug ?? "");
    const preview = (row.headline ?? "").slice(0, 60);

    if (isDryRun) {
      console.log(`  [dry-run] event=${row.eventId} slug=${row.sourceSlug} archetype=${archetype} "${preview}"`);
      skipped++;
      continue;
    }

    process.stdout.write(`  generating [${archetype}] "${preview}"… `);
    const result = await generateAndStoreIllustration(
      row.eventId,
      row.sourceSlug ?? "",
      { db },
    );

    if (result) {
      console.log(`✓ ${result.url.slice(0, 60)}…`);
      ok++;
    } else {
      console.log("✗ soft-failed (see error above)");
      failed++;
    }

    // Brief pause between calls to stay well within Recraft rate limits.
    await new Promise((r) => setTimeout(r, 800));
  }

  console.log(
    `\n[backfillIllustrations] done — ok=${ok} skipped=${skipped} failed=${failed}`,
  );
}

main().catch((err) => {
  console.error("[backfillIllustrations] fatal:", err);
  process.exit(1);
});
