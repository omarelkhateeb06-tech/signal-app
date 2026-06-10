// FRED adapter — macro data cards from Federal Reserve Economic Data
// (St. Louis Fed).
//
// Unlike the feed adapters, FRED is not a stream of articles: each
// configured series (fed funds rate, CPI, 10-year Treasury, unemployment,
// PCE) yields at most ONE candidate per poll — the latest reading — so a
// release becomes a single compact data card (content_type='filing' →
// EARNINGS/SEC card). Re-polls re-emit the same latest reading and the
// candidate-row dedup on (source_id, external_id) drops it, which is the
// same always-emit contract the RSS adapters rely on.
//
// Two requests per series: /series for metadata (title, units, frequency,
// last_updated — the release-time proxy used as publishedAt and as the
// staleness gate) and /series/observations for the readings. For the
// index-level series (CPI, PCE) the headline number is the YoY % change —
// a raw index level means nothing to a reader — computed from the
// observation 12 months back.
//
// Requires FRED_API_KEY (free, https://fred.stlouisfed.org/docs/api/api_key.html).
// When unset the adapter logs and returns no candidates — the same
// graceful-degrade pattern as the native scheduler with ANTHROPIC_API_KEY.
// The key rides in the query string, so error logs carry series IDs only,
// never URLs.
//
// Failure strings (mirrors secFormD): timeout | network | http_4xx | http_5xx

import crypto from "node:crypto";
import type { AdapterContext, AdapterResult, Candidate } from "../types";
import { humanDate } from "./secEdgarJson";

const DEFAULT_API_BASE = "https://api.stlouisfed.org/fred";
const SERIES_PAGE_BASE = "https://fred.stlouisfed.org/series";
const FETCH_TIMEOUT_MS = 30_000;
const INTER_REQUEST_DELAY_MS = 150;
const DAY_MS = 24 * 60 * 60 * 1000;

// 15 observations: enough to find the latest valid reading past leading
// missing values AND the exact-12-months-back observation for YoY math on
// a monthly series.
const OBSERVATION_LIMIT = 15;

const DEFAULT_SERIES_IDS = ["FEDFUNDS", "CPIAUCSL", "DGS10", "UNRATE", "PCEPI"];

// Max age of a series' last_updated before its latest reading is treated
// as stale and skipped (guards against carding a discontinued series).
// 45, not 14: monthly series (CPI/PCE/UNRATE) publish ~2-6 weeks after the
// observation period, so a tighter bound would drop a perfectly current
// reading for most of each month's cycle.
const DEFAULT_LOOKBACK_DAYS = 45;

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function sha256Truncated(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex").slice(0, 32);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function classifyFetchError(err: unknown): "timeout" | "network" {
  return (err as { name?: string }).name === "AbortError" ? "timeout" : "network";
}

const MAX_FETCH_ATTEMPTS = 3;
const RETRYABLE_ERRORS = new Set(["http_5xx", "timeout", "network"]);

async function requestOnce(url: string): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { Accept: "application/json" },
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

async function requestWithRetry(url: string): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt++) {
    try {
      return await requestOnce(url);
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
  const res = await requestWithRetry(url);
  return res.json();
}

// ---------- FRED response shapes ----------

interface FredSeriesResponse {
  // Not a typo — FRED's /fred/series endpoint really keys the array "seriess".
  seriess?: Array<{
    title?: string;
    units_short?: string;
    frequency_short?: string;
    last_updated?: string;
  }>;
}

interface FredObservation {
  date: string;
  value: string;
}

interface FredObservationsResponse {
  observations?: Array<{ date?: string; value?: string }>;
}

interface SeriesMeta {
  title: string | null;
  unitsShort: string | null;
  frequencyShort: string | null;
  lastUpdated: string | null;
}

// FRED timestamps look like "2026-06-01 15:16:03-05" (US Central offset,
// no minutes). Normalize to ISO and parse; null on anything unexpected.
export function parseFredTimestamp(raw: string | null): Date | null {
  if (!raw) return null;
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})([+-]\d{2})(:?\d{2})?$/.exec(raw.trim());
  if (!m) return null;
  const offsetMinutes = m[4] ? m[4].replace(":", "") : "00";
  const d = new Date(`${m[1]}T${m[2]}${m[3]}:${offsetMinutes}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

// FRED encodes missing observations as ".".
function parseFredValue(raw: string | undefined): number | null {
  if (!raw || raw === ".") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function findLatestValid(observations: FredObservation[]): FredObservation | null {
  // sort_order=desc — observations[0] is the most recent period.
  return observations.find((o) => parseFredValue(o.value) !== null) ?? null;
}

function dateMinusOneYear(isoDate: string): string {
  const m = /^(\d{4})(-\d{2}-\d{2})$/.exec(isoDate);
  return m ? `${parseInt(m[1]!, 10) - 1}${m[2]}` : isoDate;
}

// YoY % change vs the observation exactly 12 months before `latest`.
// Null when that observation is missing/invalid (young series, data gap).
function computeYoyPct(
  observations: FredObservation[],
  latest: FredObservation,
): number | null {
  const targetDate = dateMinusOneYear(latest.date);
  const prior = observations.find((o) => o.date === targetDate);
  const latestVal = parseFredValue(latest.value);
  const priorVal = prior ? parseFredValue(prior.value) : null;
  if (latestVal === null || priorVal === null || priorVal === 0) return null;
  return (latestVal / priorVal - 1) * 100;
}

// "May 2026" for monthly, "Q2 2026" for quarterly, "2026" for annual,
// "June 9, 2026" for daily/weekly/unknown cadence.
function periodLabel(isoDate: string, frequencyShort: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!m) return isoDate;
  const year = m[1]!;
  const monthIdx = parseInt(m[2]!, 10) - 1;
  switch (frequencyShort) {
    case "M":
      return MONTHS[monthIdx] ? `${MONTHS[monthIdx]} ${year}` : isoDate;
    case "Q":
      return `Q${Math.floor(monthIdx / 3) + 1} ${year}`;
    case "A":
      return year;
    default:
      return humanDate(isoDate);
  }
}

// "2.4" -> "rose 2.4%", "-0.3" -> "fell 0.3%", "0.0" -> "were flat".
function yoyVerbPhrase(formatted: string): string {
  if (formatted === "0.0" || formatted === "-0.0") return "were flat";
  return formatted.startsWith("-")
    ? `fell ${formatted.slice(1)}%`
    : `rose ${formatted}%`;
}

// "%": no space ("4.42%"); anything else: space-separated ("103.6 Index 2017=100").
function valueWithUnits(value: string, unitsShort: string | null): string {
  if (unitsShort === "%") return `${value}%`;
  return unitsShort ? `${value} ${unitsShort}` : value;
}

// Presentation for the default series set. `level` shows the reading as-is
// (all three are percent series); `yoy` headlines the 12-month % change
// because the raw index level (CPI ~320) means nothing to a reader.
// Unknown series IDs added via config fall back to metadata-driven generic
// presentation below.
interface KnownSeries {
  label: string;
  mode: "level" | "yoy";
  summarize: (value: string, period: string) => string;
}

const KNOWN_SERIES: Record<string, KnownSeries> = {
  FEDFUNDS: {
    label: "Fed Funds Rate",
    mode: "level",
    summarize: (v, p) =>
      `The effective federal funds rate — the overnight rate at the center of Fed policy — stood at ${v}% in ${p}.`,
  },
  CPIAUCSL: {
    label: "CPI Inflation",
    mode: "yoy",
    summarize: (v, p) =>
      `Consumer prices ${yoyVerbPhrase(v)} over the 12 months through ${p}, per the Bureau of Labor Statistics' Consumer Price Index.`,
  },
  DGS10: {
    label: "10-Year Treasury Yield",
    mode: "level",
    summarize: (v, p) =>
      `The 10-year U.S. Treasury yield — the benchmark for mortgage and corporate borrowing costs — stood at ${v}% on ${p}.`,
  },
  UNRATE: {
    label: "Unemployment Rate",
    mode: "level",
    summarize: (v, p) =>
      `The U.S. unemployment rate stood at ${v}% in ${p}, per the Bureau of Labor Statistics' household survey.`,
  },
  PCEPI: {
    label: "PCE Inflation",
    mode: "yoy",
    summarize: (v, p) =>
      `PCE inflation — the Federal Reserve's preferred price gauge — ran ${v}% over the 12 months through ${p}.`,
  },
};

interface Presentation {
  title: string;
  summary: string;
  yoyPct: number | null;
}

function presentReading(
  seriesId: string,
  meta: SeriesMeta,
  observations: FredObservation[],
  latest: FredObservation,
): Presentation {
  const period = periodLabel(latest.date, meta.frequencyShort);
  const known = KNOWN_SERIES[seriesId];

  if (known?.mode === "yoy") {
    const yoyPct = computeYoyPct(observations, latest);
    if (yoyPct !== null) {
      const v = yoyPct.toFixed(1) === "-0.0" ? "0.0" : yoyPct.toFixed(1);
      return {
        title: `${known.label}: ${v}% YoY (${period})`,
        summary: known.summarize(v, period),
        yoyPct,
      };
    }
    // 12-back observation unavailable — a YoY headline is impossible and a
    // bare index level under an "Inflation" label would mislead, so fall
    // through to the generic metadata-driven presentation.
  } else if (known) {
    return {
      title: `${known.label}: ${latest.value}% (${period})`,
      summary: known.summarize(latest.value, period),
      yoyPct: null,
    };
  }

  const label = meta.title ?? seriesId;
  const reading = valueWithUnits(latest.value, meta.unitsShort);
  return {
    title: `${label}: ${reading} (${period})`,
    summary: `${label} registered ${reading} for ${period}, per the Federal Reserve Economic Data (FRED) series ${seriesId}.`,
    yoyPct: null,
  };
}

function buildFredCandidate(
  seriesId: string,
  meta: SeriesMeta,
  observations: FredObservation[],
  latest: FredObservation,
): Candidate {
  const { title, summary, yoyPct } = presentReading(seriesId, meta, observations, latest);
  const url = `${SERIES_PAGE_BASE}/${seriesId}`;

  // Recent readings give the body seam real material — the FRED series
  // page itself is chart chrome and would extract to junk. For YoY series
  // these are the underlying index levels, labeled as such.
  const recent = observations
    .filter((o) => parseFredValue(o.value) !== null)
    .slice(0, 6)
    .map((o) => `${periodLabel(o.date, meta.frequencyShort)}: ${valueWithUnits(o.value, meta.unitsShort)}`)
    .join("; ");
  const readingsLabel = yoyPct !== null ? "Recent index levels" : "Recent readings";
  const seriesTitleFrag = meta.title ? ` (${meta.title})` : "";
  const bodyText =
    `${summary}\n\n${readingsLabel} — ${recent}.\n\n` +
    `Source: Federal Reserve Economic Data (FRED), Federal Reserve Bank of St. Louis — series ${seriesId}${seriesTitleFrag}.`;

  const publishedAt =
    parseFredTimestamp(meta.lastUpdated) ?? new Date(`${latest.date}T00:00:00Z`);

  return {
    externalId: `${seriesId}:${latest.date}`,
    url,
    title,
    summary,
    publishedAt,
    contentHash: sha256Truncated(`${url}\n${title}`),
    bodyText,
    rawPayload: {
      source: "fred",
      seriesId,
      seriesTitle: meta.title,
      observationDate: latest.date,
      value: latest.value,
      yoyPct,
      unitsShort: meta.unitsShort,
      frequencyShort: meta.frequencyShort,
      lastUpdated: meta.lastUpdated,
    },
  };
}

async function fetchSeriesMeta(
  base: string,
  seriesId: string,
  apiKey: string,
): Promise<SeriesMeta> {
  const url = `${base}/series?series_id=${encodeURIComponent(seriesId)}&api_key=${apiKey}&file_type=json`;
  const json = (await fetchJson(url)) as FredSeriesResponse;
  const row = json.seriess?.[0];
  return {
    title: row?.title ?? null,
    unitsShort: row?.units_short ?? null,
    frequencyShort: row?.frequency_short ?? null,
    lastUpdated: row?.last_updated ?? null,
  };
}

async function fetchObservations(
  base: string,
  seriesId: string,
  apiKey: string,
): Promise<FredObservation[]> {
  const url =
    `${base}/series/observations?series_id=${encodeURIComponent(seriesId)}` +
    `&api_key=${apiKey}&file_type=json&sort_order=desc&limit=${OBSERVATION_LIMIT}`;
  const json = (await fetchJson(url)) as FredObservationsResponse;
  return (json.observations ?? [])
    .filter((o): o is FredObservation => typeof o.date === "string" && typeof o.value === "string");
}

export async function fredApiAdapter(ctx: AdapterContext): Promise<AdapterResult> {
  const apiKey = process.env.FRED_API_KEY?.trim();
  if (!apiKey) {
    // eslint-disable-next-line no-console
    console.log(
      "[fred-adapter] FRED_API_KEY unset — skipping poll (free key: https://fred.stlouisfed.org/docs/api/api_key.html)",
    );
    return { candidates: [] };
  }

  const cfg = ctx.config ?? {};
  // Invalid or empty seriesIds falls back to the defaults — an operator
  // who wants the source off disables the row, not the list.
  const seriesIds =
    Array.isArray(cfg.seriesIds) &&
    cfg.seriesIds.length > 0 &&
    cfg.seriesIds.every((x): x is string => typeof x === "string")
      ? (cfg.seriesIds as string[])
      : DEFAULT_SERIES_IDS;
  const lookbackDays =
    typeof cfg.lookbackDays === "number" ? cfg.lookbackDays : DEFAULT_LOOKBACK_DAYS;
  const base = (ctx.endpoint ?? DEFAULT_API_BASE).replace(/\/+$/, "");

  const now = new Date();
  const candidates: Candidate[] = [];

  for (let i = 0; i < seriesIds.length; i++) {
    const seriesId = seriesIds[i]!;
    if (i > 0) await sleep(INTER_REQUEST_DELAY_MS);
    try {
      const meta = await fetchSeriesMeta(base, seriesId, apiKey);

      // Stale-series guard: a series whose last update is older than the
      // lookback window is dead or paused — don't card a months-old reading.
      const lastUpdatedAt = parseFredTimestamp(meta.lastUpdated);
      if (lastUpdatedAt && now.getTime() - lastUpdatedAt.getTime() > lookbackDays * DAY_MS) {
        // eslint-disable-next-line no-console
        console.log(
          `[fred-adapter] series ${seriesId} last updated ${meta.lastUpdated} — older than lookbackDays=${lookbackDays}, skipping`,
        );
        continue;
      }

      const observations = await fetchObservations(base, seriesId, apiKey);
      const latest = findLatestValid(observations);
      if (!latest) {
        // eslint-disable-next-line no-console
        console.log(`[fred-adapter] series ${seriesId} has no valid recent observations — skipping`);
        continue;
      }

      candidates.push(buildFredCandidate(seriesId, meta, observations, latest));
    } catch (err) {
      // One series failing must not abort the sweep. Series ID only — the
      // request URLs carry the API key and must never be logged.
      // eslint-disable-next-line no-console
      console.error(
        `[fred-adapter] series ${seriesId} failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return { candidates };
}
