import { fredApiAdapter } from "../../src/jobs/ingestion/adapters/fredApi";
import type { AdapterContext } from "../../src/jobs/ingestion/types";

const DAY_MS = 24 * 60 * 60 * 1000;

function makeCtx(overrides: Partial<AdapterContext> = {}): AdapterContext {
  return {
    sourceId: "00000000-0000-0000-0000-000000000020",
    slug: "fred-api",
    adapterType: "fred_api",
    endpoint: "https://api.stlouisfed.org/fred",
    config: {},
    lastPolledAt: new Date("2026-06-09T00:00:00Z"),
    ...overrides,
  };
}

// FRED's last_updated format ("2026-06-01 15:16:03-05"), rendered in UTC.
// Built relative to now so staleness-gate behavior never depends on when
// the suite runs.
function fredTimestamp(d: Date): string {
  return `${d.toISOString().slice(0, 19).replace("T", " ")}+00`;
}

// A Date on whole seconds (FRED timestamps carry no millis), offset back
// from now by `agoMs`.
function wholeSecondsAgo(agoMs: number): Date {
  return new Date(Math.floor((Date.now() - agoMs) / 1000) * 1000);
}

interface SeriesSpec {
  id: string;
  title?: string;
  unitsShort?: string;
  frequencyShort?: string;
  lastUpdated?: string;
  observations: Array<{ date: string; value: string }>;
}

function jsonResponse(payload: unknown): Response {
  return {
    status: 200,
    headers: { get: () => "application/json" },
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as unknown as Response;
}

// URL-routed fetch mock: /series/observations → that series' readings;
// /series → its metadata. Routing keys on the series_id query param.
// (Observations must be checked first — its path contains "/series".)
function installFetchMock(series: SeriesSpec[]): jest.Mock {
  const byId = new Map(series.map((s) => [s.id, s]));
  const fn = jest.fn(async (url: string) => {
    const m = /[?&]series_id=([^&]+)/.exec(url);
    const spec = m ? byId.get(m[1]!) : undefined;
    if (!spec) throw new Error("network");
    if (url.includes("/series/observations")) {
      return jsonResponse({ observations: spec.observations });
    }
    return jsonResponse({
      seriess: [
        {
          id: spec.id,
          title: spec.title ?? `${spec.id} title`,
          units_short: spec.unitsShort ?? "%",
          frequency_short: spec.frequencyShort ?? "M",
          last_updated: spec.lastUpdated ?? fredTimestamp(wholeSecondsAgo(60 * 60 * 1000)),
        },
      ],
    });
  });
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

describe("fredApiAdapter", () => {
  const ORIGINAL_FRED_KEY = process.env.FRED_API_KEY;

  beforeEach(() => {
    process.env.FRED_API_KEY = "test-key";
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete (global as { fetch?: unknown }).fetch;
  });

  afterAll(() => {
    if (ORIGINAL_FRED_KEY === undefined) delete process.env.FRED_API_KEY;
    else process.env.FRED_API_KEY = ORIGINAL_FRED_KEY;
  });

  it("emits a data card for the latest reading of a level series", async () => {
    const updatedAt = wholeSecondsAgo(60 * 60 * 1000);
    const fn = installFetchMock([
      {
        id: "FEDFUNDS",
        title: "Federal Funds Effective Rate",
        unitsShort: "%",
        frequencyShort: "M",
        lastUpdated: fredTimestamp(updatedAt),
        observations: [
          { date: "2026-05-01", value: "5.33" },
          { date: "2026-04-01", value: "5.33" },
          { date: "2026-03-01", value: "5.32" },
        ],
      },
    ]);
    const result = await fredApiAdapter(makeCtx({ config: { seriesIds: ["FEDFUNDS"] } }));
    expect(result.candidates.length).toBe(1);
    const c = result.candidates[0]!;
    expect(c.title).toBe("Fed Funds Rate: 5.33% (May 2026)");
    expect(c.summary).toBe(
      "The effective federal funds rate — the overnight rate at the center of Fed policy — stood at 5.33% in May 2026.",
    );
    expect(c.externalId).toBe("FEDFUNDS:2026-05-01");
    expect(c.url).toBe("https://fred.stlouisfed.org/series/FEDFUNDS");
    expect(c.publishedAt?.getTime()).toBe(updatedAt.getTime());
    expect(c.bodyText).toContain("Recent readings — May 2026: 5.33%; April 2026: 5.33%");
    expect(c.bodyText).toContain(
      "Source: Federal Reserve Economic Data (FRED), Federal Reserve Bank of St. Louis — series FEDFUNDS",
    );
    expect(c.rawPayload.seriesId).toBe("FEDFUNDS");
    expect(c.rawPayload.value).toBe("5.33");
    // The key rides in the query string of every request.
    expect(String(fn.mock.calls[0]![0])).toContain("api_key=test-key");
    expect(String(fn.mock.calls[0]![0])).toContain("series_id=FEDFUNDS");
  });

  it("headlines the YoY change for an index series (CPI)", async () => {
    installFetchMock([
      {
        id: "CPIAUCSL",
        title: "Consumer Price Index for All Urban Consumers: All Items in U.S. City Average",
        unitsShort: "Index 1982-84=100",
        frequencyShort: "M",
        observations: [
          { date: "2026-05-01", value: "318.000" },
          { date: "2026-04-01", value: "316.500" },
          { date: "2025-05-01", value: "300.000" },
        ],
      },
    ]);
    const result = await fredApiAdapter(makeCtx({ config: { seriesIds: ["CPIAUCSL"] } }));
    expect(result.candidates.length).toBe(1);
    const c = result.candidates[0]!;
    expect(c.title).toBe("CPI Inflation: 6.0% YoY (May 2026)");
    expect(c.summary).toBe(
      "Consumer prices rose 6.0% over the 12 months through May 2026, per the Bureau of Labor Statistics' Consumer Price Index.",
    );
    expect(c.rawPayload.yoyPct as number).toBeCloseTo(6.0, 5);
    expect(c.bodyText).toContain("Recent index levels — May 2026: 318.000 Index 1982-84=100");
  });

  it("skips a missing latest observation ('.') and uses the prior valid one", async () => {
    installFetchMock([
      {
        id: "DGS10",
        title: "Market Yield on U.S. Treasury Securities at 10-Year Constant Maturity",
        unitsShort: "%",
        frequencyShort: "D",
        observations: [
          { date: "2026-06-10", value: "." },
          { date: "2026-06-09", value: "4.42" },
          { date: "2026-06-08", value: "4.45" },
        ],
      },
    ]);
    const result = await fredApiAdapter(makeCtx({ config: { seriesIds: ["DGS10"] } }));
    expect(result.candidates.length).toBe(1);
    const c = result.candidates[0]!;
    expect(c.title).toBe("10-Year Treasury Yield: 4.42% (June 9, 2026)");
    expect(c.externalId).toBe("DGS10:2026-06-09");
  });

  it("falls back to generic presentation when the YoY baseline is missing", async () => {
    installFetchMock([
      {
        id: "CPIAUCSL",
        title: "Consumer Price Index for All Urban Consumers: All Items in U.S. City Average",
        unitsShort: "Index 1982-84=100",
        frequencyShort: "M",
        // No 2025-05-01 observation — YoY is uncomputable; an index level
        // under a "CPI Inflation" label would mislead.
        observations: [
          { date: "2026-05-01", value: "318.591" },
          { date: "2026-04-01", value: "316.500" },
        ],
      },
    ]);
    const result = await fredApiAdapter(makeCtx({ config: { seriesIds: ["CPIAUCSL"] } }));
    expect(result.candidates.length).toBe(1);
    const c = result.candidates[0]!;
    expect(c.title).toBe(
      "Consumer Price Index for All Urban Consumers: All Items in U.S. City Average: 318.591 Index 1982-84=100 (May 2026)",
    );
    expect(c.summary).toContain("per the Federal Reserve Economic Data (FRED) series CPIAUCSL");
    expect(c.rawPayload.yoyPct).toBeNull();
  });

  it("presents an unknown configured series from its FRED metadata", async () => {
    installFetchMock([
      {
        id: "INDPRO",
        title: "Industrial Production: Total Index",
        unitsShort: "Index 2017=100",
        frequencyShort: "M",
        observations: [
          { date: "2026-04-01", value: "103.6" },
          { date: "2026-03-01", value: "103.1" },
        ],
      },
    ]);
    const result = await fredApiAdapter(makeCtx({ config: { seriesIds: ["INDPRO"] } }));
    expect(result.candidates.length).toBe(1);
    const c = result.candidates[0]!;
    expect(c.title).toBe("Industrial Production: Total Index: 103.6 Index 2017=100 (April 2026)");
    expect(c.summary).toBe(
      "Industrial Production: Total Index registered 103.6 Index 2017=100 for April 2026, per the Federal Reserve Economic Data (FRED) series INDPRO.",
    );
  });

  it("returns no candidates and makes no requests when FRED_API_KEY is unset", async () => {
    delete process.env.FRED_API_KEY;
    const fn = installFetchMock([
      {
        id: "FEDFUNDS",
        observations: [{ date: "2026-05-01", value: "5.33" }],
      },
    ]);
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const result = await fredApiAdapter(makeCtx({ config: { seriesIds: ["FEDFUNDS"] } }));
    expect(result.candidates.length).toBe(0);
    expect(fn).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("FRED_API_KEY unset"));
  });

  it("drops a stale series by default and keeps it under a wider lookbackDays", async () => {
    const staleUpdated = fredTimestamp(wholeSecondsAgo(90 * DAY_MS));
    installFetchMock([
      {
        id: "UNRATE",
        unitsShort: "%",
        frequencyShort: "M",
        lastUpdated: staleUpdated,
        observations: [{ date: "2026-02-01", value: "4.1" }],
      },
    ]);
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});

    // Default lookbackDays (45) — 90 days stale, dropped.
    const dropped = await fredApiAdapter(makeCtx({ config: { seriesIds: ["UNRATE"] } }));
    expect(dropped.candidates.length).toBe(0);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("older than lookbackDays=45"));

    // Config override widens the window — kept.
    const kept = await fredApiAdapter(
      makeCtx({ config: { seriesIds: ["UNRATE"], lookbackDays: 365 } }),
    );
    expect(kept.candidates.length).toBe(1);
    expect(kept.candidates[0]!.title).toBe("Unemployment Rate: 4.1% (February 2026)");
  });

  it("continues past a series whose fetch persistently 5xxs", async () => {
    const good: SeriesSpec = {
      id: "FEDFUNDS",
      unitsShort: "%",
      frequencyShort: "M",
      observations: [{ date: "2026-05-01", value: "5.33" }],
    };
    global.fetch = jest.fn(async (url: string) => {
      if (url.includes("series_id=UNRATE")) {
        return {
          status: 503,
          headers: { get: () => "text/plain" },
          text: async () => "unavailable",
          json: async () => ({}),
        } as unknown as Response;
      }
      if (url.includes("/series/observations")) {
        return jsonResponse({ observations: good.observations });
      }
      return jsonResponse({
        seriess: [
          {
            id: good.id,
            title: "Federal Funds Effective Rate",
            units_short: good.unitsShort,
            frequency_short: good.frequencyShort,
            last_updated: fredTimestamp(wholeSecondsAgo(60 * 60 * 1000)),
          },
        ],
      });
    }) as unknown as typeof fetch;

    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const result = await fredApiAdapter(
      makeCtx({ config: { seriesIds: ["UNRATE", "FEDFUNDS"] } }),
    );
    expect(result.candidates.length).toBe(1);
    expect(result.candidates[0]!.rawPayload.seriesId).toBe("FEDFUNDS");
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("series UNRATE failed"),
      "http_5xx",
    );
    errorSpy.mockRestore();
  });
});
