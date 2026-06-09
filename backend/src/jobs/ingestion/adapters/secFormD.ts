// SEC Form D adapter — discovery of notable private financings.
//
// Unlike secEdgarJson (which watches a FIXED CIK list for periodic
// reports), Form D is a DISCOVERY stream: any company filing a Reg D
// exempt offering — i.e. "we raised / are raising a private round." We
// can't know the issuers in advance (they're startups and funds), so we
// poll EDGAR full-text search (EFTS) for recent Form D filings, then
// fetch each filing's primary_doc.xml for the industry group + offering
// size.
//
// Form D is a firehose (~1,400 filings/week, mostly real-estate /
// EB-5 / small LP funds). The downstream Haiku relevance gate assigns
// the final ai/finance/semiconductors sector and rejects off-topic
// filings — but running it on the raw firehose would burn a Haiku call
// per EB-5 fund. So this adapter pre-filters cheaply on (industry group,
// offering size) to hand the gate a small, plausibly-relevant set. Both
// thresholds live in the source row's `config` so tuning is a data
// change, not a code change.
//
// SEC fair-access policy: descriptive User-Agent with a contact, and
// <10 requests/second (we use a 150ms inter-request delay).
//
// Failure strings (mirrors secEdgarJson): timeout | network | http_4xx | http_5xx

import crypto from "node:crypto";
import type { AdapterContext, AdapterResult, Candidate } from "../types";
import { humanizeCompanyName, humanDate } from "./secEdgarJson";

const EFTS_URL = "https://efts.sec.gov/LATEST/search-index";
const ARCHIVES_BASE = "https://www.sec.gov/Archives/edgar/data";
const USER_AGENT = "SIGNAL/12 signal-ingestion (+contact@signal.so)";
const FETCH_TIMEOUT_MS = 30_000;
const INTER_REQUEST_DELAY_MS = 150;

const DEFAULT_LOOKBACK_DAYS = 2;
const DEFAULT_MIN_OFFERING_USD = 5_000_000;
const DEFAULT_MAX_FILINGS = 150;
const MAX_EFTS_PAGES = 30; // safety bound on pagination

// Form D `industryGroupType` leaf values we keep. The Haiku gate makes
// the final ai/finance/semiconductors call; this list strips the obvious
// noise before the gate runs. Tunable via config.industryAllowlist.
//
// DEFAULT = operating-company tech only. The "Crunchbase replacement"
// signal is "an operating company raised a round," which files under
// Computers / Other Technology / Telecommunications / Manufacturing. The
// fund categories (Pooled Investment Fund, Investing, Investment Banking)
// are DELIBERATELY excluded by default — a live sample showed ~85% of
// "tech" Form D volume is generic VC/PE LP-fund and SPV raises, which is
// a different, far noisier signal. Add them via config if fund-raise
// coverage is wanted. Strings matched case-insensitively.
const DEFAULT_INDUSTRY_ALLOWLIST = [
  "Computers",
  "Other Technology",
  "Telecommunications",
  "Manufacturing",
];

// Roman-numeral series tokens that humanizeCompanyName's title-casing
// mangles ("VIII" -> "Viii"). Re-uppercased in cleanFormDName.
const ROMAN_NUMERALS = new Set([
  "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x", "xi", "xii", "xiii",
]);

function sha256Truncated(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex").slice(0, 32);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function classifyFetchError(err: unknown): "timeout" | "network" {
  return (err as { name?: string }).name === "AbortError" ? "timeout" : "network";
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function formatUsd(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n}`;
}

function titleCaseLoc(s: string): string {
  return s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

// Form D entity names are ALL-CAPS and often carry trailing commas or
// series suffixes. humanizeCompanyName (shared with the EDGAR adapter)
// title-cases + drops legal suffixes; this adds Form-D-specific cleanup:
// strip trailing/leading punctuation, and re-uppercase roman-numeral
// series tokens that title-casing lowercased ("Viii" -> "VIII").
function cleanFormDName(raw: string): string {
  const base = humanizeCompanyName(raw).replace(/^[\s,;]+|[\s,;]+$/g, "").trim();
  const fixed = base
    .split(/\s+/)
    .map((tok) => {
      const bare = tok.replace(/[.,]/g, "").toLowerCase();
      return ROMAN_NUMERALS.has(bare) ? tok.toUpperCase() : tok;
    })
    .join(" ");
  return fixed || raw;
}

// First inner-text match for <tag>…</tag> (Form D XML is flat enough that
// a regex beats pulling in an XML parser; mirrors the regex approach in
// secEdgarJson's humanizers).
function pickTag(xml: string, tag: string): string | null {
  const m = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i").exec(xml);
  return m && m[1] != null ? m[1].trim() : null;
}

interface EftsHit {
  adsh: string;
  cik: string;
  fileDate: string;
}

interface EftsResponse {
  hits?: {
    total?: { value?: number };
    hits?: Array<{
      _source?: {
        adsh?: string;
        ciks?: string[];
        file_date?: string;
      };
    }>;
  };
}

const MAX_FETCH_ATTEMPTS = 3;
// EFTS is an Elasticsearch backend that transiently 5xxs under load; SEC
// also rate-limits. Retry those + network/timeout; never retry a 4xx.
const RETRYABLE_ERRORS = new Set(["http_5xx", "timeout", "network"]);

async function requestOnce(url: string, accept: string): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: accept },
        signal: ctrl.signal,
      });
    } catch (err) {
      throw new Error(classifyFetchError(err));
    }
    if (res.status >= 400 && res.status < 500) throw new Error("http_4xx");
    if (res.status >= 500) throw new Error("http_5xx");
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function requestWithRetry(url: string, accept: string): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt++) {
    try {
      return await requestOnce(url, accept);
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (!RETRYABLE_ERRORS.has(msg) || attempt === MAX_FETCH_ATTEMPTS) throw err;
      await sleep(300 * attempt); // 300ms, then 600ms
    }
  }
  throw lastErr;
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await requestWithRetry(url, "application/json");
  return res.json();
}

async function fetchText(url: string): Promise<string> {
  const res = await requestWithRetry(url, "application/xml,text/xml");
  return res.text();
}

// Page through EFTS Form D hits for [startDate, endDate], up to maxFilings.
async function collectFormDHits(
  startDate: string,
  endDate: string,
  maxFilings: number,
): Promise<EftsHit[]> {
  const out: EftsHit[] = [];
  let from = 0;
  let total = Infinity;

  for (let page = 0; page < MAX_EFTS_PAGES && out.length < maxFilings; page++) {
    if (page > 0) await sleep(INTER_REQUEST_DELAY_MS);
    const url =
      `${EFTS_URL}?q=&forms=D&startdt=${startDate}&enddt=${endDate}&from=${from}`;
    const json = (await fetchJson(url)) as EftsResponse;
    const hits = json.hits?.hits ?? [];
    total = json.hits?.total?.value ?? out.length + hits.length;
    if (hits.length === 0) break;

    for (const h of hits) {
      const adsh = h._source?.adsh;
      const cik = h._source?.ciks?.[0];
      const fileDate = h._source?.file_date ?? "";
      if (adsh && cik) out.push({ adsh, cik, fileDate });
    }
    from += hits.length;
    if (from >= total) break;
  }

  if (out.length > maxFilings) {
    // eslint-disable-next-line no-console
    console.log(
      `[form-d-adapter] capped at maxFilings=${maxFilings} (saw ${total} total in window) — increase config.maxFilings to widen`,
    );
    return out.slice(0, maxFilings);
  }
  return out;
}

interface ParsedFormD {
  entityName: string;
  industry: string | null;
  offeringAmount: number | null;
  city: string | null;
  state: string | null;
}

function parseFormDXml(xml: string): ParsedFormD {
  const entityName =
    pickTag(xml, "entityName") ?? pickTag(xml, "issuerName") ?? "Unknown issuer";
  const industry = pickTag(xml, "industryGroupType");
  const rawAmount = pickTag(xml, "totalOfferingAmount");
  // "Indefinite" (common for funds) → null = "unknown size, don't penalize".
  const offeringAmount =
    rawAmount && /^\d+$/.test(rawAmount) ? parseInt(rawAmount, 10) : null;
  return {
    entityName,
    industry,
    offeringAmount,
    city: pickTag(xml, "city"),
    state: pickTag(xml, "stateOrCountryDescription") ?? pickTag(xml, "stateOrCountry"),
  };
}

function industryAllowed(industry: string | null, allowlist: string[]): boolean {
  if (!industry) return false;
  const norm = industry.trim().toLowerCase();
  return allowlist.some((a) => a.trim().toLowerCase() === norm);
}

function buildFormDCandidate(
  hit: EftsHit,
  parsed: ParsedFormD,
): Candidate {
  const numericCik = hit.cik.replace(/^0+/, "");
  const adshNoDash = hit.adsh.replace(/-/g, "");
  const url = `${ARCHIVES_BASE}/${numericCik}/${adshNoDash}/${hit.adsh}-index.htm`;

  const company = cleanFormDName(parsed.entityName);
  // Amount is guaranteed present post-filter, but guard for type-safety.
  const amountLabel =
    parsed.offeringAmount && parsed.offeringAmount > 0
      ? `${formatUsd(parsed.offeringAmount)} `
      : "";
  const title = `${company} — ${amountLabel}private financing (Form D)`;

  // Parenthetical industry dodges the a/an article problem ("a Other
  // Technology" is wrong) and reads cleanly for every group.
  const industryFrag = parsed.industry ? ` (${parsed.industry})` : "";
  const loc = [parsed.city, parsed.state]
    .filter((x): x is string => Boolean(x))
    .map(titleCaseLoc)
    .join(", ");
  const locFrag = loc ? `, based in ${loc},` : "";
  const amountFrag =
    parsed.offeringAmount && parsed.offeringAmount > 0
      ? ` a ${formatUsd(parsed.offeringAmount)}`
      : " a";
  const dateFrag = hit.fileDate ? ` on ${humanDate(hit.fileDate)}` : "";
  const summary =
    `${company}${industryFrag}${locFrag} reported${amountFrag} private securities ` +
    `offering (Reg D / Form D) filed with the SEC${dateFrag}.`;

  return {
    externalId: hit.adsh,
    url,
    title,
    summary,
    publishedAt: hit.fileDate ? new Date(`${hit.fileDate}T00:00:00Z`) : null,
    contentHash: sha256Truncated(`${url}\n${title}`),
    rawPayload: {
      accessionNumber: hit.adsh,
      cik: hit.cik,
      entityName: parsed.entityName,
      industryGroupType: parsed.industry,
      totalOfferingAmount: parsed.offeringAmount,
      filingDate: hit.fileDate,
      form: "D",
    },
  };
}

export async function secFormDAdapter(ctx: AdapterContext): Promise<AdapterResult> {
  const cfg = ctx.config ?? {};
  const minOffering =
    typeof cfg.minOfferingUsd === "number" ? cfg.minOfferingUsd : DEFAULT_MIN_OFFERING_USD;
  const maxFilings =
    typeof cfg.maxFilings === "number" ? cfg.maxFilings : DEFAULT_MAX_FILINGS;
  const lookbackDays =
    typeof cfg.lookbackDays === "number" ? cfg.lookbackDays : DEFAULT_LOOKBACK_DAYS;
  const allowlist =
    Array.isArray(cfg.industryAllowlist) &&
    cfg.industryAllowlist.every((x): x is string => typeof x === "string")
      ? (cfg.industryAllowlist as string[])
      : DEFAULT_INDUSTRY_ALLOWLIST;

  const now = new Date();
  const since = ctx.lastPolledAt
    ? new Date(ctx.lastPolledAt)
    : new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
  const startDate = toIsoDate(since);
  const endDate = toIsoDate(now);

  const hits = await collectFormDHits(startDate, endDate, maxFilings);

  const candidates: Candidate[] = [];
  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i]!;
    if (i > 0) await sleep(INTER_REQUEST_DELAY_MS);
    const numericCik = hit.cik.replace(/^0+/, "");
    const adshNoDash = hit.adsh.replace(/-/g, "");
    const xmlUrl = `${ARCHIVES_BASE}/${numericCik}/${adshNoDash}/primary_doc.xml`;
    try {
      const xml = await fetchText(xmlUrl);
      const parsed = parseFormDXml(xml);

      // Pre-filter: industry allowlist + a DISCLOSED offering >= threshold.
      // Null / "Indefinite" / 0 amounts carry no size signal and are
      // dropped — the "notable raise" bar is a real dollar figure, which is
      // also what makes the card worth showing. The Haiku gate then makes
      // the final relevance + sector call on what survives.
      if (!industryAllowed(parsed.industry, allowlist)) continue;
      if (parsed.offeringAmount === null || parsed.offeringAmount < minOffering) continue;

      candidates.push(buildFormDCandidate(hit, parsed));
    } catch (err) {
      // One filing failing must not abort the sweep.
      // eslint-disable-next-line no-console
      console.error(
        `[form-d-adapter] filing ${hit.adsh} failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return { candidates };
}
