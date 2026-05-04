// SEC EDGAR JSON adapter (Phase 12e.5d).
//
// Fetches https://data.sec.gov/submissions/CIK{cik}.json for each CIK
// in config.ciks and emits recent filings of interest (10-K, 10-Q, 8-K,
// S-1, 20-F) as candidates. Body text is unavailable at this stage —
// the heuristic body-fetch step (12e.3) retrieves the actual document.
//
// SEC EDGAR fair-access policy requires:
//   - A descriptive User-Agent identifying the app and a contact email.
//   - No more than 10 requests/second (we stay well under with 150ms delay).
//
// Failure strings: timeout | network | http_4xx | http_5xx | parse_error

import crypto from "node:crypto";
import type { AdapterContext, AdapterResult, Candidate } from "../types";

const FETCH_TIMEOUT_MS = 30_000;
const USER_AGENT = "SIGNAL/12e.5d signal-ingestion (+contact@signal.so)";
const INTER_CIK_DELAY_MS = 150;
const RELEVANT_FORMS = new Set(["10-K", "10-Q", "8-K", "S-1", "20-F"]);
const DEFAULT_LOOKBACK_DAYS = 7;

function sha256Truncated(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex").slice(0, 32);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function classifyFetchError(err: unknown): "timeout" | "network" {
  return (err as { name?: string }).name === "AbortError" ? "timeout" : "network";
}

// Pad CIK to 10 digits (EDGAR standard).
function padCik(cik: string): string {
  return cik.replace(/^0+/, "").padStart(10, "0");
}

function accessionToPath(accession: string): string {
  return accession.replace(/-/g, "");
}

interface EdgarFilings {
  recent: {
    accessionNumber: string[];
    filingDate: string[];
    form: string[];
    primaryDocument: string[];
  };
}

interface EdgarSubmissions {
  name?: string;
  cik?: string;
  filings?: EdgarFilings;
}

async function fetchCikCandidates(
  cik: string,
  since: Date,
  first: boolean,
): Promise<Candidate[]> {
  if (!first) await sleep(INTER_CIK_DELAY_MS);

  const paddedCik = padCik(cik);
  const url = `https://data.sec.gov/submissions/CIK${paddedCik}.json`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  let data: EdgarSubmissions;
  try {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        signal: ctrl.signal,
      });
    } catch (err) {
      throw new Error(classifyFetchError(err));
    }
    if (res.status >= 400 && res.status < 500) throw new Error("http_4xx");
    if (res.status >= 500) throw new Error("http_5xx");
    data = (await res.json()) as EdgarSubmissions;
  } finally {
    clearTimeout(timer);
  }

  const companyName = data.name ?? `CIK ${cik}`;
  const recent = data.filings?.recent;
  if (!recent) return [];

  const candidates: Candidate[] = [];
  const count = recent.accessionNumber.length;

  for (let i = 0; i < count; i++) {
    const form = recent.form[i] ?? "";
    if (!RELEVANT_FORMS.has(form)) continue;

    const filingDateStr = recent.filingDate[i] ?? "";
    const filingDate = filingDateStr ? new Date(`${filingDateStr}T00:00:00Z`) : null;
    if (!filingDate || filingDate < since) continue;

    const accession = recent.accessionNumber[i] ?? "";
    const primaryDoc = recent.primaryDocument[i] ?? "";
    const numericCik = cik.replace(/^0+/, "");
    const filingUrl = primaryDoc
      ? `https://www.sec.gov/Archives/edgar/data/${numericCik}/${accessionToPath(accession)}/${primaryDoc}`
      : `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${paddedCik}&type=${form}`;

    const title = `${companyName} — ${form} (${filingDateStr})`;
    const externalId = accession;
    const contentHash = sha256Truncated(`${filingUrl}\n${title}`);

    candidates.push({
      externalId,
      url: filingUrl,
      title,
      summary: null,
      publishedAt: filingDate,
      contentHash,
      rawPayload: {
        cik,
        companyName,
        accessionNumber: accession,
        form,
        filingDate: filingDateStr,
        primaryDocument: primaryDoc,
      },
    });
  }

  return candidates;
}

export async function secEdgarJsonAdapter(ctx: AdapterContext): Promise<AdapterResult> {
  const rawCiks = ctx.config.ciks;
  if (!Array.isArray(rawCiks) || rawCiks.length === 0) {
    // No CIK list = nothing to fetch. Not an error — the source may
    // be the sec-edgar-full row (now typed 'rss') or a misconfigured row.
    return { candidates: [] };
  }
  const ciks = rawCiks.filter((c): c is string => typeof c === "string");

  const since = ctx.lastPolledAt
    ? new Date(ctx.lastPolledAt)
    : new Date(Date.now() - DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  const all: Candidate[] = [];
  for (let i = 0; i < ciks.length; i++) {
    const cik = ciks[i];
    if (!cik) continue;
    try {
      const candidates = await fetchCikCandidates(cik, since, i === 0);
      all.push(...candidates);
    } catch (err) {
      // One CIK failing shouldn't abort the rest. Log and continue.
      // eslint-disable-next-line no-console
      console.error(
        `[edgar-adapter] CIK ${cik} failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return { candidates: all };
}
