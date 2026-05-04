import { secEdgarJsonAdapter } from "../../src/jobs/ingestion/adapters/secEdgarJson";
import type { AdapterContext } from "../../src/jobs/ingestion/types";

function makeCtx(overrides: Partial<AdapterContext> = {}): AdapterContext {
  return {
    sourceId: "00000000-0000-0000-0000-000000000002",
    slug: "sec-edgar-semis",
    adapterType: "sec_edgar_json",
    endpoint: "https://data.sec.gov/submissions/CIK{cik}.json",
    config: {},
    lastPolledAt: null,
    ...overrides,
  };
}

interface FilingRow {
  accessionNumber: string;
  filingDate: string;
  form: string;
  primaryDocument: string;
}

function buildSubmissionsJson(name: string, rows: FilingRow[]): unknown {
  return {
    name,
    cik: "1045810",
    filings: {
      recent: {
        accessionNumber: rows.map((r) => r.accessionNumber),
        filingDate: rows.map((r) => r.filingDate),
        form: rows.map((r) => r.form),
        primaryDocument: rows.map((r) => r.primaryDocument),
      },
    },
  };
}

function mockJson(payload: unknown): jest.Mock {
  const fn = jest.fn().mockResolvedValue({
    status: 200,
    headers: { get: () => "application/json" },
    json: async () => payload,
  } as unknown as Response);
  global.fetch = fn;
  return fn;
}

describe("secEdgarJsonAdapter", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    delete (global as { fetch?: unknown }).fetch;
  });

  describe("config validation", () => {
    it("returns empty candidates when config.ciks is missing", async () => {
      const fetchMock = jest.fn();
      global.fetch = fetchMock;
      const result = await secEdgarJsonAdapter(makeCtx({ config: {} }));
      expect(result.candidates).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("returns empty candidates when config.ciks is an empty array", async () => {
      const fetchMock = jest.fn();
      global.fetch = fetchMock;
      const result = await secEdgarJsonAdapter(makeCtx({ config: { ciks: [] } }));
      expect(result.candidates).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("happy path", () => {
    it("emits candidates only for relevant forms (10-K, 10-Q, 8-K, S-1, 20-F)", async () => {
      const since = new Date("2026-04-01T00:00:00Z");
      mockJson(
        buildSubmissionsJson("NVIDIA CORP", [
          { accessionNumber: "0001045810-26-000001", filingDate: "2026-04-15", form: "10-K", primaryDocument: "nv10k.htm" },
          { accessionNumber: "0001045810-26-000002", filingDate: "2026-04-14", form: "10-Q", primaryDocument: "nv10q.htm" },
          { accessionNumber: "0001045810-26-000003", filingDate: "2026-04-13", form: "8-K", primaryDocument: "nv8k.htm" },
          { accessionNumber: "0001045810-26-000004", filingDate: "2026-04-12", form: "S-1", primaryDocument: "nvs1.htm" },
          { accessionNumber: "0001045810-26-000005", filingDate: "2026-04-11", form: "20-F", primaryDocument: "nv20f.htm" },
          { accessionNumber: "0001045810-26-000006", filingDate: "2026-04-10", form: "DEF 14A", primaryDocument: "proxy.htm" },
          { accessionNumber: "0001045810-26-000007", filingDate: "2026-04-09", form: "SC 13G", primaryDocument: "sc13g.htm" },
          { accessionNumber: "0001045810-26-000008", filingDate: "2026-04-08", form: "4", primaryDocument: "form4.xml" },
        ]),
      );
      const result = await secEdgarJsonAdapter(
        makeCtx({ config: { ciks: ["0001045810"] }, lastPolledAt: since }),
      );
      expect(result.candidates.length).toBe(5);
      const forms = result.candidates.map((c) => c.rawPayload.form);
      expect(forms).toEqual(["10-K", "10-Q", "8-K", "S-1", "20-F"]);
    });

    it("excludes filings older than `since` (lastPolledAt)", async () => {
      const since = new Date("2026-04-10T00:00:00Z");
      mockJson(
        buildSubmissionsJson("NVIDIA CORP", [
          { accessionNumber: "0001045810-26-000001", filingDate: "2026-04-15", form: "10-K", primaryDocument: "a.htm" },
          { accessionNumber: "0001045810-26-000002", filingDate: "2026-04-09", form: "10-K", primaryDocument: "b.htm" },
          { accessionNumber: "0001045810-26-000003", filingDate: "2026-01-01", form: "10-K", primaryDocument: "c.htm" },
        ]),
      );
      const result = await secEdgarJsonAdapter(
        makeCtx({ config: { ciks: ["0001045810"] }, lastPolledAt: since }),
      );
      expect(result.candidates.length).toBe(1);
      expect(result.candidates[0]!.externalId).toBe("0001045810-26-000001");
    });

    it("constructs the EDGAR Archives URL correctly", async () => {
      const since = new Date("2026-04-01T00:00:00Z");
      mockJson(
        buildSubmissionsJson("NVIDIA CORP", [
          {
            accessionNumber: "0001045810-26-000123",
            filingDate: "2026-04-15",
            form: "10-K",
            primaryDocument: "nv10k2026.htm",
          },
        ]),
      );
      const result = await secEdgarJsonAdapter(
        makeCtx({ config: { ciks: ["0001045810"] }, lastPolledAt: since }),
      );
      expect(result.candidates[0]!.url).toBe(
        "https://www.sec.gov/Archives/edgar/data/1045810/000104581026000123/nv10k2026.htm",
      );
    });

    it("titles candidates as `{companyName} — {form} ({filingDate})`", async () => {
      const since = new Date("2026-04-01T00:00:00Z");
      mockJson(
        buildSubmissionsJson("NVIDIA CORP", [
          { accessionNumber: "0001045810-26-000001", filingDate: "2026-04-15", form: "10-K", primaryDocument: "x.htm" },
        ]),
      );
      const result = await secEdgarJsonAdapter(
        makeCtx({ config: { ciks: ["0001045810"] }, lastPolledAt: since }),
      );
      expect(result.candidates[0]!.title).toBe("NVIDIA CORP — 10-K (2026-04-15)");
      expect(result.candidates[0]!.summary).toBeNull();
    });

    it("uses default 7-day lookback when lastPolledAt is null", async () => {
      // Stable "now" so the 7-day boundary is deterministic.
      jest.useFakeTimers().setSystemTime(new Date("2026-04-20T00:00:00Z"));
      try {
        mockJson(
          buildSubmissionsJson("NVIDIA CORP", [
            { accessionNumber: "0001045810-26-000001", filingDate: "2026-04-19", form: "10-K", primaryDocument: "a.htm" },
            { accessionNumber: "0001045810-26-000002", filingDate: "2026-04-10", form: "10-K", primaryDocument: "b.htm" },
          ]),
        );
        const result = await secEdgarJsonAdapter(
          makeCtx({ config: { ciks: ["0001045810"] }, lastPolledAt: null }),
        );
        expect(result.candidates.length).toBe(1);
        expect(result.candidates[0]!.externalId).toBe("0001045810-26-000001");
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe("multi-CIK behavior", () => {
    it("continues to next CIK when one CIK fetch fails", async () => {
      const since = new Date("2026-04-01T00:00:00Z");
      const fetchMock = jest
        .fn()
        // First CIK: HTTP 500.
        .mockResolvedValueOnce({
          status: 500,
          headers: { get: () => "text/plain" },
          text: async () => "server error",
          json: async () => ({}),
        } as unknown as Response)
        // Second CIK: success.
        .mockResolvedValueOnce({
          status: 200,
          headers: { get: () => "application/json" },
          json: async () =>
            buildSubmissionsJson("AMD", [
              { accessionNumber: "0000002488-26-000099", filingDate: "2026-04-15", form: "10-K", primaryDocument: "amd.htm" },
            ]),
        } as unknown as Response);
      global.fetch = fetchMock;

      // Suppress the [edgar-adapter] error log for the failing CIK.
      const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

      const result = await secEdgarJsonAdapter(
        makeCtx({ config: { ciks: ["0001045810", "0000002488"] }, lastPolledAt: since }),
      );

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(result.candidates.length).toBe(1);
      expect(result.candidates[0]!.rawPayload.companyName).toBe("AMD");
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });

    it("aggregates candidates across multiple CIKs", async () => {
      const since = new Date("2026-04-01T00:00:00Z");
      const fetchMock = jest
        .fn()
        .mockResolvedValueOnce({
          status: 200,
          headers: { get: () => "application/json" },
          json: async () =>
            buildSubmissionsJson("NVIDIA CORP", [
              { accessionNumber: "0001045810-26-000001", filingDate: "2026-04-15", form: "10-K", primaryDocument: "n.htm" },
            ]),
        } as unknown as Response)
        .mockResolvedValueOnce({
          status: 200,
          headers: { get: () => "application/json" },
          json: async () =>
            buildSubmissionsJson("AMD", [
              { accessionNumber: "0000002488-26-000001", filingDate: "2026-04-14", form: "8-K", primaryDocument: "a.htm" },
            ]),
        } as unknown as Response);
      global.fetch = fetchMock;

      const result = await secEdgarJsonAdapter(
        makeCtx({ config: { ciks: ["0001045810", "0000002488"] }, lastPolledAt: since }),
      );
      expect(result.candidates.length).toBe(2);
      expect(result.candidates.map((c) => c.rawPayload.companyName)).toEqual([
        "NVIDIA CORP",
        "AMD",
      ]);
    });
  });
});
