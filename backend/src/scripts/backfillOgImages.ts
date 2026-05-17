// Phase 12k — backfill stories.image_url and events.image_url for rows
// that landed before the og:image extractor was wired into the
// enrichment body fetch.
//
// Strategy: refetch each row's source URL (stories.source_url /
// events.primary_source_url) and run the same `extractOgImage` helper
// the live pipeline uses against the parsed HTML. Two flavors of work
// share one tight rate limiter so we don't accidentally double-rate
// against a single host across the two tables.
//
// Idempotency: only touches rows where image_url IS NULL. Re-runs are
// safe; if the process is interrupted (Ctrl-C, broken pipe), restarting
// resumes exactly where it left off because completed rows are no
// longer NULL.
//
// Politeness: 2 requests per second across the whole run (one row every
// 500ms). 15s per-request timeout (matches DEFAULT_BODY_TIMEOUT_MS in
// bodyExtractor.ts so this script can't out-trust the live pipeline).
//
// Progress: a one-line log every 50 rows with running counts.
//
// CLI:
//   npm run backfill-og-images
//   npm run backfill-og-images -- --dry-run
//   npm run backfill-og-images -- --table=stories
//   npm run backfill-og-images -- --table=events

import "dotenv/config";
import { JSDOM, VirtualConsole } from "jsdom";
import { eq, isNull } from "drizzle-orm";

import { db } from "../db";
import { events, stories } from "../db/schema";
import {
  DEFAULT_BODY_USER_AGENT,
  DEFAULT_BODY_TIMEOUT_MS,
  extractOgImage,
} from "../jobs/ingestion/bodyExtractor";

const RATE_LIMIT_MS = 500;
const LOG_EVERY = 50;

interface Args {
  dryRun: boolean;
  table: "stories" | "events" | "both";
}

function parseArgs(argv: readonly string[]): Args {
  const dryRun = argv.includes("--dry-run");
  let table: Args["table"] = "both";
  for (const arg of argv) {
    if (arg === "--table=stories") table = "stories";
    else if (arg === "--table=events") table = "events";
    else if (arg === "--table=both") table = "both";
  }
  return { dryRun, table };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface FetchOgImageResult {
  imageUrl: string | null;
  reason: "ok" | "no_meta" | "fetch_error" | "wrong_content_type" | "parse_error";
}

// Self-contained og:image fetch. Mirrors the bodyExtractor fetch shape
// (User-Agent, timeout, content-type gate, JSDOM parse) but skips the
// readability pass — we only need the meta tag. Keeping it inline
// avoids dragging in the readability dependency, paywall detection, and
// body-size logic for a backfill that only cares about one tag.
async function fetchOgImage(url: string): Promise<FetchOgImageResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DEFAULT_BODY_TIMEOUT_MS);
  let res: Response;
  try {
    try {
      res = await fetch(url, {
        headers: {
          "User-Agent": DEFAULT_BODY_USER_AGENT,
          Accept: "text/html, */*;q=0.5",
        },
        signal: ctrl.signal,
      });
    } catch {
      return { imageUrl: null, reason: "fetch_error" };
    }
    if (res.status < 200 || res.status >= 300) {
      try {
        await res.text();
      } catch {
        /* ignore */
      }
      return { imageUrl: null, reason: "fetch_error" };
    }
    const contentType =
      res.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
    if (contentType !== "text/html") {
      try {
        await res.text();
      } catch {
        /* ignore */
      }
      return { imageUrl: null, reason: "wrong_content_type" };
    }
    let html: string;
    try {
      html = await res.text();
    } catch {
      return { imageUrl: null, reason: "fetch_error" };
    }
    let imageUrl: string | null;
    try {
      // Silent VirtualConsole — by default jsdom forwards CSS parse
      // warnings, resource-load errors, and other internal noise from
      // the parsed page to Node's console. That's the source of the
      // raw HTML/CSS dump that pollutes the backfill log. A fresh
      // VirtualConsole with no `sendTo()` swallows it all; the
      // backfill only cares about extracted meta tags.
      const virtualConsole = new VirtualConsole();
      const dom = new JSDOM(html, { url, virtualConsole });
      imageUrl = extractOgImage(dom.window.document, url);
    } catch {
      return { imageUrl: null, reason: "parse_error" };
    }
    return { imageUrl, reason: imageUrl ? "ok" : "no_meta" };
  } finally {
    clearTimeout(timer);
  }
}

interface BackfillStats {
  scanned: number;
  updated: number;
  noImage: number;
  errors: number;
}

function logProgress(
  label: string,
  index: number,
  total: number,
  stats: BackfillStats,
): void {
  // eslint-disable-next-line no-console
  console.log(
    `[backfill-og-images][${label}] ${index}/${total} scanned=${stats.scanned} updated=${stats.updated} noImage=${stats.noImage} errors=${stats.errors}`,
  );
}

async function backfillStoriesTable(dryRun: boolean): Promise<BackfillStats> {
  const stats: BackfillStats = { scanned: 0, updated: 0, noImage: 0, errors: 0 };
  const rows = await db
    .select({ id: stories.id, sourceUrl: stories.sourceUrl })
    .from(stories)
    .where(isNull(stories.imageUrl));
  const total = rows.length;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    stats.scanned += 1;
    const result = await fetchOgImage(row.sourceUrl);
    if (result.reason === "ok" && result.imageUrl) {
      if (!dryRun) {
        await db
          .update(stories)
          .set({ imageUrl: result.imageUrl })
          .where(eq(stories.id, row.id));
      }
      stats.updated += 1;
    } else if (result.reason === "no_meta") {
      stats.noImage += 1;
    } else {
      stats.errors += 1;
    }
    if (stats.scanned % LOG_EVERY === 0) {
      logProgress("stories", i + 1, total, stats);
    }
    if (i < rows.length - 1) await sleep(RATE_LIMIT_MS);
  }
  logProgress("stories", total, total, stats);
  return stats;
}

async function backfillEventsTable(dryRun: boolean): Promise<BackfillStats> {
  const stats: BackfillStats = { scanned: 0, updated: 0, noImage: 0, errors: 0 };
  const rows = await db
    .select({ id: events.id, primarySourceUrl: events.primarySourceUrl })
    .from(events)
    .where(isNull(events.imageUrl));
  const total = rows.length;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    stats.scanned += 1;
    const result = await fetchOgImage(row.primarySourceUrl);
    if (result.reason === "ok" && result.imageUrl) {
      if (!dryRun) {
        await db
          .update(events)
          .set({ imageUrl: result.imageUrl })
          .where(eq(events.id, row.id));
      }
      stats.updated += 1;
    } else if (result.reason === "no_meta") {
      stats.noImage += 1;
    } else {
      stats.errors += 1;
    }
    if (stats.scanned % LOG_EVERY === 0) {
      logProgress("events", i + 1, total, stats);
    }
    if (i < rows.length - 1) await sleep(RATE_LIMIT_MS);
  }
  logProgress("events", total, total, stats);
  return stats;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  // eslint-disable-next-line no-console
  console.log(
    `[backfill-og-images] table=${args.table} dryRun=${args.dryRun} rate=2req/s`,
  );

  if (args.table === "stories" || args.table === "both") {
    const s = await backfillStoriesTable(args.dryRun);
    // eslint-disable-next-line no-console
    console.log(
      `[backfill-og-images][stories] DONE scanned=${s.scanned} updated=${s.updated} noImage=${s.noImage} errors=${s.errors}`,
    );
  }
  if (args.table === "events" || args.table === "both") {
    const e = await backfillEventsTable(args.dryRun);
    // eslint-disable-next-line no-console
    console.log(
      `[backfill-og-images][events]  DONE scanned=${e.scanned} updated=${e.updated} noImage=${e.noImage} errors=${e.errors}`,
    );
  }

  process.exit(0);
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error("[backfill-og-images] FAILED", err);
    process.exit(1);
  });
}
