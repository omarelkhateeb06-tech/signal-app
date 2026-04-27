/* eslint-disable no-console */
/**
 * Read-only liveness audit for every `source_url` in the `stories` table.
 *
 * Usage:
 *   npm run audit:story-urls --workspace=backend
 *
 * Behavior:
 *   - SELECT id, headline, source_url FROM stories
 *   - Per URL: HEAD first with a browser-like User-Agent, follow up to 5
 *     redirects, 10s timeout per hop. On 405 Method Not Allowed, retry
 *     once with GET (some publishers block HEAD).
 *   - Runs sequentially to avoid publisher rate-limiting.
 *   - Classifies results into buckets:
 *       2xx ok
 *       3xx redirect (should be rare — we follow)
 *       403 blocked (bot protection — needs manual verification)
 *       4xx broken
 *       5xx server-error
 *       timeout
 *       error (DNS, TLS, aborted, unknown)
 *   - Writes identical output to stdout and
 *     `backend/seed-data/url-audit-<UTC-YYYY-MM-DD>.txt`.
 *   - Exit code 0 iff every URL landed in 2xx; 1 otherwise.
 *
 * No DB writes. No URL mutation. Report-only.
 */

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { db, pool } from "../db";
import * as schema from "../db/schema";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 5;

type Bucket = "2xx" | "3xx" | "403" | "4xx" | "5xx" | "timeout" | "headers-overflow" | "error";

interface AuditResult {
  storyId: string;
  headline: string;
  originalUrl: string;
  finalUrl: string;
  status: number | null;
  bucket: Bucket;
  method: "HEAD" | "GET";
  hops: number;
  errorClass?: string;
}

function bucketFor(status: number | null, errorClass?: string): Bucket {
  if (errorClass === "timeout") return "timeout";
  if (errorClass === "headers-overflow") return "headers-overflow";
  if (errorClass) return "error";
  if (status === null) return "error";
  if (status === 403) return "403";
  if (status >= 200 && status < 300) return "2xx";
  if (status >= 300 && status < 400) return "3xx";
  if (status >= 400 && status < 500) return "4xx";
  if (status >= 500 && status < 600) return "5xx";
  return "error";
}

// Node's built-in fetch (undici) rejects responses whose headers exceed
// the default 16KB limit. Some publishers (Yahoo Finance is the usual
// suspect) set so many cookies/telemetry headers that they trip this —
// origin is fine, response is just unparseable by our client. Classify
// distinctly so the report doesn't conflate with DNS/TLS/DNS failures.
function classifyError(err: unknown): string {
  const e = err as { name?: string; cause?: { code?: string; name?: string } };
  if (e.name === "AbortError") return "timeout";
  if (e.cause?.code === "UND_ERR_HEADERS_OVERFLOW") return "headers-overflow";
  return e.name ?? "Error";
}

async function fetchOnce(
  url: string,
  method: "HEAD" | "GET",
): Promise<{ status: number; location: string | null }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method,
      redirect: "manual",
      headers: {
        "User-Agent": UA,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: ctrl.signal,
    });
    // Drain body for GET so the connection can close; HEAD has no body.
    if (method === "GET") {
      try {
        await res.arrayBuffer();
      } catch {
        /* ignore */
      }
    }
    return { status: res.status, location: res.headers.get("location") };
  } finally {
    clearTimeout(timer);
  }
}

function resolveLocation(base: string, location: string): string {
  try {
    return new URL(location, base).toString();
  } catch {
    return location;
  }
}

async function auditUrl(
  storyId: string,
  headline: string,
  originalUrl: string,
): Promise<AuditResult> {
  let current = originalUrl;
  let method: "HEAD" | "GET" = "HEAD";
  let hops = 0;

  for (; hops <= MAX_REDIRECTS; hops += 1) {
    let status: number;
    let location: string | null;
    try {
      ({ status, location } = await fetchOnce(current, method));
    } catch (err) {
      const errorClass = classifyError(err);
      return {
        storyId,
        headline,
        originalUrl,
        finalUrl: current,
        status: null,
        bucket: bucketFor(null, errorClass),
        method,
        hops,
        errorClass,
      };
    }

    if (status === 405 && method === "HEAD") {
      method = "GET";
      continue;
    }

    if (status >= 300 && status < 400 && location) {
      if (hops >= MAX_REDIRECTS) {
        return {
          storyId,
          headline,
          originalUrl,
          finalUrl: current,
          status,
          bucket: "3xx",
          method,
          hops,
          errorClass: "too-many-redirects",
        };
      }
      current = resolveLocation(current, location);
      method = "HEAD";
      continue;
    }

    return {
      storyId,
      headline,
      originalUrl,
      finalUrl: current,
      status,
      bucket: bucketFor(status),
      method,
      hops,
    };
  }

  return {
    storyId,
    headline,
    originalUrl,
    finalUrl: current,
    status: null,
    bucket: "error",
    method,
    hops,
    errorClass: "redirect-loop",
  };
}

function formatLine(r: AuditResult): string {
  const statusStr = r.status === null ? r.errorClass ?? "error" : String(r.status);
  const snippet = r.headline.length > 70 ? r.headline.slice(0, 67) + "..." : r.headline;
  const arrow = r.finalUrl !== r.originalUrl ? ` -> ${r.finalUrl}` : "";
  const hopStr = r.hops > 0 ? ` [${r.hops} hop${r.hops === 1 ? "" : "s"}]` : "";
  const methodNote = r.method === "GET" ? " [GET fallback]" : "";
  return `[${statusStr}]${methodNote}${hopStr} ${r.originalUrl}${arrow} (story: ${snippet})`;
}

function utcDateStamp(d: Date = new Date()): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

export async function run(): Promise<number> {
  const lines: string[] = [];
  const emit = (s: string): void => {
    console.log(s);
    lines.push(s);
  };
  const log = (s: string): void => emit(`[audit] ${s}`);

  log(`starting (User-Agent: ${UA.slice(0, 60)}...)`);
  log(`timeout ${TIMEOUT_MS}ms, max ${MAX_REDIRECTS} redirects`);

  const rows = await db
    .select({
      id: schema.stories.id,
      headline: schema.stories.headline,
      sourceUrl: schema.stories.sourceUrl,
    })
    .from(schema.stories)
    .orderBy(schema.stories.publishedAt);

  log(`${rows.length} stories to audit`);
  emit("");

  const results: AuditResult[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (!row) continue;
    process.stdout.write(`[audit] ${i + 1}/${rows.length} ${row.sourceUrl}\r`);
    const r = await auditUrl(row.id, row.headline, row.sourceUrl);
    results.push(r);
    // Clear the progress line, then emit result
    process.stdout.write("\r".padEnd(120, " ") + "\r");
    emit(formatLine(r));
  }

  emit("");
  log("summary:");
  const buckets: Record<Bucket, number> = {
    "2xx": 0,
    "3xx": 0,
    "403": 0,
    "4xx": 0,
    "5xx": 0,
    timeout: 0,
    "headers-overflow": 0,
    error: 0,
  };
  for (const r of results) buckets[r.bucket] += 1;
  log(`  2xx ok                         : ${buckets["2xx"]}`);
  log(`  3xx (residual redirect)        : ${buckets["3xx"]}`);
  log(`  403 blocked (bot guard)        : ${buckets["403"]}`);
  log(`  4xx broken                     : ${buckets["4xx"]}`);
  log(`  5xx server error               : ${buckets["5xx"]}`);
  log(`  timeout                        : ${buckets.timeout}`);
  log(`  headers-overflow (reachable)   : ${buckets["headers-overflow"]}`);
  log(`  error (dns/tls/other)          : ${buckets.error}`);

  const nonOk = results.filter((r) => r.bucket !== "2xx");
  if (nonOk.length > 0) {
    emit("");
    log(`${nonOk.length} non-2xx URL(s) needing attention:`);
    for (const r of nonOk) {
      const note =
        r.bucket === "403"
          ? "blocked — likely bot protection, verify manually in a browser"
          : r.bucket === "timeout"
            ? "timed out — check connectivity and retry"
            : r.bucket === "3xx"
              ? "unresolved redirect chain — verify final destination manually"
              : r.bucket === "4xx"
                ? "broken — consider updating source_url"
                : r.bucket === "5xx"
                  ? "origin server error — retry later or replace"
                  : r.bucket === "headers-overflow"
                    ? "origin reachable but response headers exceed Node undici's 16KB limit — verify manually"
                    : "transport error — see error class";
      log(`  - ${formatLine(r)}`);
      log(`      action: ${note}`);
    }
  } else {
    emit("");
    log("all URLs returned 2xx");
  }

  // Persist to file
  const outDir = path.resolve(process.cwd(), "seed-data");
  const outFile = path.join(outDir, `url-audit-${utcDateStamp()}.txt`);
  fs.writeFileSync(outFile, lines.join("\n") + "\n", "utf-8");
  log(`wrote ${outFile}`);

  return nonOk.length === 0 ? 0 : 1;
}

async function main(): Promise<void> {
  let exitCode = 0;
  try {
    exitCode = await run();
  } catch (err) {
    exitCode = 1;
    console.error("[audit] error:", err instanceof Error ? err.message : err);
  } finally {
    try {
      await pool.end();
    } catch {
      /* ignore */
    }
  }
  process.exit(exitCode);
}

if (require.main === module) {
  void main();
}
