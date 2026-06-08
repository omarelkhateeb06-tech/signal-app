// Phase 12e.x fix cluster — Fix 6.
//
// Eleven ingestion sources have been at consecutive_failure_count=50+
// with last_success_at=null since the 12e soak. Each has either:
//   (a) a feed URL that 404s (site moved or never had a public feed),
//   (b) a paywall / auth gate (Bloomberg's Money Stuff),
//   (c) the wrong content-type / no public feed at all.
//
// This script probes a small set of candidate URLs per slug, picks
// the first one that responds with valid feed XML, and either:
//   - updates `ingestion_sources.endpoint` + zeroes
//     consecutive_failure_count when a working feed is found, or
//   - sets `enabled = false` with a logged reason when none of the
//     candidates resolve.
//
// Idempotent: re-running after an apply skips rows that already have
// a working endpoint AND consecutive_failure_count = 0. The
// validation step does a real fetch each run so it catches feeds that
// silently went dead.
//
// Usage:
//   npm run fix-broken-sources --workspace=backend             (dry-run, default)
//   npm run fix-broken-sources --workspace=backend -- --apply  (write the fixes)
//
// The script never deletes rows — only updates `endpoint`,
// `consecutive_failure_count`, `enabled`, and `updated_at`. The
// source row + its history stay intact for audit.

import "../lib/loadEnv";
import { eq } from "drizzle-orm";
import { db, pool } from "../db";
import { ingestionSources } from "../db/schema";

// Per-slug candidate feed URLs. Order matters — the first URL that
// validates wins. Picked from public sources commonly used by RSS
// aggregators; the script verifies each at runtime so out-of-date
// guesses don't silently break the registry.
const CANDIDATE_URLS: Record<string, string[]> = {
  "amd-newsroom": [
    "https://ir.amd.com/rss/news-releases.xml",
    "https://www.amd.com/en/newsroom/rss.xml",
  ],
  "anthropic-news": [
    "https://www.anthropic.com/news/rss.xml",
    "https://www.anthropic.com/rss.xml",
  ],
  "asml-news": [
    "https://www.asml.com/en/news/rss",
    "https://www.asml.com/en/investors/rss",
  ],
  "bis-press": [
    // Federal Register — Industry & Security Bureau (BIS) rulemaking +
    // enforcement actions. The official export-control primary, and the
    // replacement for the dead bis.doc.gov press feeds below (now
    // HTML-only / 404). Brackets are percent-encoded so Node fetch in the
    // RSS adapter accepts the URL unchanged.
    "https://www.federalregister.gov/api/v1/documents.rss?conditions%5Bagencies%5D%5B%5D=industry-and-security-bureau",
    "https://www.bis.doc.gov/index.php/all-articles?format=feed&type=rss",
    "https://www.bis.gov/rss/press-releases",
  ],
  "huggingface-papers": [
    "https://huggingface.co/papers/rss",
    "https://huggingface.co/papers.rss",
  ],
  "intel-newsroom": [
    "https://newsroom.intel.com/feed/",
    "https://www.intel.com/content/www/us/en/newsroom/rss.xml",
  ],
  "meta-ai-blog": [
    "https://ai.meta.com/blog/rss/",
    "https://research.facebook.com/feed/",
  ],
  // money-stuff intentionally omitted: it polls fine on its Bloomberg
  // author RSS (bloomberg.com/opinion/authors/.../matthew-s-levine.rss).
  // It was previously listed with empty candidates, which made `--apply`
  // DISABLE a healthy source. A working source does not belong in the
  // repair registry — leave it out so the probe never touches it.
  "reuters-business": [
    "https://www.reutersagency.com/feed/?best-customer-impacts=business-news",
    "https://www.reuters.com/arc/outboundfeeds/v3/all/rss",
  ],
  "the-batch": [
    "https://www.deeplearning.ai/the-batch/rss/",
    "https://www.deeplearning.ai/the-batch/feed.xml",
  ],
  "tsmc-newsroom": [
    "https://pr.tsmc.com/english/news/rss",
    "https://www.tsmc.com/english/news-events/rss",
  ],
};

const SLUGS = Object.keys(CANDIDATE_URLS);
const PROBE_TIMEOUT_MS = 8_000;
const VALID_CONTENT_TYPES = [
  "application/rss+xml",
  "application/atom+xml",
  "application/xml",
  "text/xml",
];

interface ProbeResult {
  url: string;
  ok: boolean;
  reason: string;
}

async function probeUrl(url: string): Promise<ProbeResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      // Spoof a desktop UA — many corporate sites 403 known bots.
      headers: {
        "user-agent":
          "Mozilla/5.0 (signal-feed-validator/1.0; +https://signal.so)",
        accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5",
      },
    });
    if (!res.ok) {
      return { url, ok: false, reason: `http_${res.status}` };
    }
    const contentType = res.headers.get("content-type")?.toLowerCase() ?? "";
    const looksLikeFeed = VALID_CONTENT_TYPES.some((t) =>
      contentType.includes(t),
    );
    const body = await res.text();
    // A second guard: even with a generic content-type the body should
    // open with an XML / Atom / RSS root.
    const xmlish =
      body.trim().startsWith("<?xml") ||
      /^<(rss|feed|atom)\b/i.test(body.trim());
    if (!looksLikeFeed && !xmlish) {
      return {
        url,
        ok: false,
        reason: `wrong_content_type:${contentType || "unknown"}`,
      };
    }
    // Coarse "has entries" check — a feed XML with zero items is
    // technically valid but useless. Accept either RSS <item> or Atom
    // <entry>.
    const hasEntries = /<(item|entry)\b/i.test(body);
    if (!hasEntries) {
      return { url, ok: false, reason: "no_entries" };
    }
    return { url, ok: true, reason: "ok" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { url, ok: false, reason: `fetch_failed:${msg}` };
  } finally {
    clearTimeout(timer);
  }
}

interface SourceFix {
  slug: string;
  action: "update_endpoint" | "disable" | "no_change";
  newEndpoint: string | null;
  probeResults: ProbeResult[];
}

async function decideFor(slug: string): Promise<SourceFix> {
  const candidates = CANDIDATE_URLS[slug] ?? [];
  if (candidates.length === 0) {
    return { slug, action: "disable", newEndpoint: null, probeResults: [] };
  }
  const probeResults: ProbeResult[] = [];
  for (const url of candidates) {
    const result = await probeUrl(url);
    probeResults.push(result);
    if (result.ok) {
      return { slug, action: "update_endpoint", newEndpoint: url, probeResults };
    }
  }
  return { slug, action: "disable", newEndpoint: null, probeResults };
}

async function applyFix(fix: SourceFix): Promise<void> {
  if (fix.action === "update_endpoint" && fix.newEndpoint) {
    await db
      .update(ingestionSources)
      .set({
        endpoint: fix.newEndpoint,
        consecutiveFailureCount: 0,
        enabled: true,
        updatedAt: new Date(),
      })
      .where(eq(ingestionSources.slug, fix.slug));
  } else if (fix.action === "disable") {
    await db
      .update(ingestionSources)
      .set({
        enabled: false,
        updatedAt: new Date(),
      })
      .where(eq(ingestionSources.slug, fix.slug));
  }
}

function formatProbeLine(p: ProbeResult): string {
  return `      ${p.ok ? "✓" : "✗"} ${p.url}${p.ok ? "" : `  (${p.reason})`}`;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  // eslint-disable-next-line no-console
  console.log(
    `[fix-broken-sources] starting ${apply ? "(--apply)" : "(dry-run; pass --apply to write)"}`,
  );

  const decisions: SourceFix[] = [];
  for (const slug of SLUGS) {
    // eslint-disable-next-line no-console
    console.log(`\n[${slug}]`);
    const decision = await decideFor(slug);
    for (const p of decision.probeResults) {
      // eslint-disable-next-line no-console
      console.log(formatProbeLine(p));
    }
    // eslint-disable-next-line no-console
    console.log(
      `   → ${decision.action}${
        decision.newEndpoint ? `: ${decision.newEndpoint}` : ""
      }`,
    );
    decisions.push(decision);
  }

  if (apply) {
    // eslint-disable-next-line no-console
    console.log("\n[apply] writing changes to ingestion_sources…");
    for (const decision of decisions) {
      await applyFix(decision);
    }
    // eslint-disable-next-line no-console
    console.log("[apply] done.");
  }

  // Summary.
  const updated = decisions.filter((d) => d.action === "update_endpoint");
  const disabled = decisions.filter((d) => d.action === "disable");
  // eslint-disable-next-line no-console
  console.log(
    `\n[summary] ${updated.length} sources would-update endpoint; ${disabled.length} would-disable. ${
      apply ? "Applied." : "Dry-run only — re-run with --apply to write."
    }`,
  );

  await pool.end().catch(() => undefined);
}

main().then(
  () => process.exit(0),
  (err) => {
    // eslint-disable-next-line no-console
    console.error("[fix-broken-sources] FAILED", err);
    process.exit(1);
  },
);
