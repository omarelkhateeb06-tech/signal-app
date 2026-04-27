// URL canonicalization for the ingestion pipeline.
//
// Pre-locked rules (see Phase 12e.2 stage 1 audit, "Stage 2 decisions" #2):
//   1. Lowercase scheme and host. Path case is preserved (case-sensitive
//      on many CMS-driven sites).
//   2. Strip default ports (:80 on http, :443 on https).
//   3. Strip URL fragment (#...).
//   4. Strip tracking query params (allow-list below). `source=` is only
//      stripped when its value is `email`, `rss`, or `feed` — leaves
//      legitimate `source=user` etc. alone.
//   5. Sort remaining query params alphabetically by key.
//   6. Strip a single trailing slash from the path only if the path has
//      more than one segment (i.e. don't turn "/" into "").
//   7. Do NOT IDN-encode hosts; we have no evidence-driven need yet.
//
// Idempotent: canonicalizeUrl(canonicalizeUrl(x)) === canonicalizeUrl(x).
// Pure: no I/O. Throws on inputs that fail WHATWG URL parsing.

const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "_ga",
  "ref",
  "ref_src",
  "mkt_tok",
]);

const SOURCE_PARAM_BLOCKED_VALUES = new Set(["email", "rss", "feed"]);

export function canonicalizeUrl(url: string): string {
  const u = new URL(url);

  // Rule 1+7: lowercase scheme/host (URL parser already lowercases,
  // re-asserting is cheap insurance against future spec drift).
  u.protocol = u.protocol.toLowerCase();
  u.hostname = u.hostname.toLowerCase();

  // Rule 2: strip default ports.
  if (
    (u.protocol === "http:" && u.port === "80") ||
    (u.protocol === "https:" && u.port === "443")
  ) {
    u.port = "";
  }

  // Rule 3: strip fragment.
  u.hash = "";

  // Rule 4 + 5: filter then sort query params.
  const filtered: Array<[string, string]> = [];
  for (const [key, value] of u.searchParams.entries()) {
    if (TRACKING_PARAMS.has(key)) continue;
    if (key === "source" && SOURCE_PARAM_BLOCKED_VALUES.has(value)) continue;
    filtered.push([key, value]);
  }
  filtered.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  // Replace search by rebuilding from the sorted list.
  u.search = "";
  for (const [key, value] of filtered) {
    u.searchParams.append(key, value);
  }

  // Rule 6: strip trailing slash if path has > 1 segment.
  // Path segments are non-empty splits on "/". e.g. "/" → [], "/foo" → ["foo"],
  // "/foo/" → ["foo"], "/foo/bar/" → ["foo", "bar"]. Strip iff segments >= 2
  // OR (segments === 1 && trailing slash AND we're not at "/").
  // The pre-locked rule says "strip single trailing slash if path has more
  // than one segment" — interpret as len(segments) > 1.
  if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
    const segments = u.pathname.split("/").filter((s) => s.length > 0);
    if (segments.length > 1) {
      u.pathname = u.pathname.replace(/\/$/, "");
    }
  }

  return u.toString();
}
