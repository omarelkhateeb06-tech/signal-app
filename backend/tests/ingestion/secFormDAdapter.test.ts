import { secFormDAdapter } from "../../src/jobs/ingestion/adapters/secFormD";
import type { AdapterContext } from "../../src/jobs/ingestion/types";

function makeCtx(overrides: Partial<AdapterContext> = {}): AdapterContext {
  return {
    sourceId: "00000000-0000-0000-0000-000000000010",
    slug: "sec-form-d",
    adapterType: "sec_form_d",
    endpoint: "https://efts.sec.gov/LATEST/search-index",
    config: {},
    lastPolledAt: new Date("2026-06-05T00:00:00Z"),
    ...overrides,
  };
}

interface HitSpec {
  cik: string;
  adsh: string;
  entityName: string;
  industry: string;
  amount: string; // raw <totalOfferingAmount> text ("50000000" | "Indefinite" | "0")
  city?: string;
  state?: string;
  fileDate?: string;
}

function buildEftsResponse(hits: HitSpec[]): unknown {
  return {
    hits: {
      total: { value: hits.length },
      hits: hits.map((h) => ({
        _source: {
          adsh: h.adsh,
          ciks: [h.cik],
          file_date: h.fileDate ?? "2026-06-08",
        },
      })),
    },
  };
}

function buildFormDXml(h: HitSpec): string {
  return `<?xml version="1.0"?>
<edgarSubmission>
  <primaryIssuer>
    <entityName>${h.entityName}</entityName>
    <issuerAddress>
      <city>${h.city ?? "SAN FRANCISCO"}</city>
      <stateOrCountryDescription>${h.state ?? "CALIFORNIA"}</stateOrCountryDescription>
    </issuerAddress>
  </primaryIssuer>
  <offeringData>
    <industryGroup><industryGroupType>${h.industry}</industryGroupType></industryGroup>
    <offeringSalesAmounts>
      <totalOfferingAmount>${h.amount}</totalOfferingAmount>
      <totalAmountSold>0</totalAmountSold>
    </offeringSalesAmounts>
  </offeringData>
</edgarSubmission>`;
}

// URL-routed fetch mock: EFTS search → JSON; primary_doc.xml → that CIK's
// Form D XML. XML routing keys on the numeric CIK in the Archives path.
function installFetchMock(hits: HitSpec[]): jest.Mock {
  const byCik = new Map(hits.map((h) => [h.cik.replace(/^0+/, ""), h]));
  const fn = jest.fn(async (url: string) => {
    if (url.includes("search-index")) {
      return {
        status: 200,
        headers: { get: () => "application/json" },
        json: async () => buildEftsResponse(hits),
        text: async () => JSON.stringify(buildEftsResponse(hits)),
      } as unknown as Response;
    }
    // primary_doc.xml — find the CIK segment.
    const m = /edgar\/data\/(\d+)\//.exec(url);
    const hit = m ? byCik.get(m[1]!) : undefined;
    if (!hit) throw new Error("network");
    return {
      status: 200,
      headers: { get: () => "application/xml" },
      text: async () => buildFormDXml(hit),
      json: async () => ({}),
    } as unknown as Response;
  });
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

describe("secFormDAdapter", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    delete (global as { fetch?: unknown }).fetch;
  });

  it("keeps an operating-tech filing with a disclosed amount over threshold", async () => {
    installFetchMock([
      {
        cik: "0001234567",
        adsh: "0001234567-26-000001",
        entityName: "ACME ROBOTICS INC",
        industry: "Computers",
        amount: "50000000",
        city: "PALO ALTO",
        state: "CALIFORNIA",
        fileDate: "2026-06-08",
      },
    ]);
    const result = await secFormDAdapter(makeCtx());
    expect(result.candidates.length).toBe(1);
    const c = result.candidates[0]!;
    expect(c.title).toBe("Acme Robotics — $50.0M private financing (Form D)");
    expect(c.summary).toBe(
      "Acme Robotics (Computers), based in Palo Alto, California, reported a $50.0M private securities offering (Reg D / Form D) filed with the SEC on June 8, 2026.",
    );
    expect(c.externalId).toBe("0001234567-26-000001");
    expect(c.url).toBe(
      "https://www.sec.gov/Archives/edgar/data/1234567/000123456726000001/0001234567-26-000001-index.htm",
    );
    expect(c.rawPayload.industryGroupType).toBe("Computers");
  });

  it("drops a filing whose industry is not in the allowlist (real estate)", async () => {
    installFetchMock([
      {
        cik: "0002000001",
        adsh: "0002000001-26-000001",
        entityName: "VEDIC VILLAGE EB-5 FUND LLC",
        industry: "Other Real Estate",
        amount: "16000000",
      },
    ]);
    const result = await secFormDAdapter(makeCtx());
    expect(result.candidates.length).toBe(0);
  });

  it("drops an allowlisted filing below the offering threshold", async () => {
    installFetchMock([
      {
        cik: "0002000002",
        adsh: "0002000002-26-000001",
        entityName: "TINY TECH CO",
        industry: "Other Technology",
        amount: "1000000", // $1M < $5M default
      },
    ]);
    const result = await secFormDAdapter(makeCtx());
    expect(result.candidates.length).toBe(0);
  });

  it("drops an allowlisted filing with no disclosed amount (Indefinite)", async () => {
    installFetchMock([
      {
        cik: "0002000003",
        adsh: "0002000003-26-000001",
        entityName: "OPEN ENDED FUND",
        industry: "Manufacturing",
        amount: "Indefinite",
      },
    ]);
    const result = await secFormDAdapter(makeCtx());
    expect(result.candidates.length).toBe(0);
  });

  it("cleans the company name — roman numerals + trailing comma", async () => {
    installFetchMock([
      {
        cik: "0003000001",
        adsh: "0003000001-26-000001",
        entityName: "INDUSTRIOUS VENTURES GROWTH VIII,",
        industry: "Other Technology",
        amount: "25000000",
      },
    ]);
    const result = await secFormDAdapter(makeCtx());
    expect(result.candidates[0]!.title).toBe(
      "Industrious Ventures Growth VIII — $25.0M private financing (Form D)",
    );
  });

  it("honors config overrides (industryAllowlist + minOfferingUsd)", async () => {
    installFetchMock([
      {
        cik: "0004000001",
        adsh: "0004000001-26-000001",
        entityName: "POOLED FUND LP",
        industry: "Pooled Investment Fund",
        amount: "8000000",
      },
    ]);
    // Default would drop Pooled Investment Fund; config re-adds it + lowers the bar.
    const result = await secFormDAdapter(
      makeCtx({
        config: { industryAllowlist: ["Pooled Investment Fund"], minOfferingUsd: 5_000_000 },
      }),
    );
    expect(result.candidates.length).toBe(1);
    expect(result.candidates[0]!.rawPayload.industryGroupType).toBe(
      "Pooled Investment Fund",
    );
  });

  it("continues past a filing whose detail fetch fails", async () => {
    const hits: HitSpec[] = [
      {
        cik: "0005000001",
        adsh: "0005000001-26-000001",
        entityName: "GOOD CO",
        industry: "Computers",
        amount: "30000000",
      },
      {
        cik: "0005000002",
        adsh: "0005000002-26-000001",
        entityName: "BROKEN CO",
        industry: "Computers",
        amount: "30000000",
      },
    ];
    // Route the second CIK's XML to a persistent 5xx (exhausts retries).
    const byCik = new Map(hits.map((h) => [h.cik.replace(/^0+/, ""), h]));
    global.fetch = jest.fn(async (url: string) => {
      if (url.includes("search-index")) {
        return {
          status: 200,
          headers: { get: () => "application/json" },
          json: async () => buildEftsResponse(hits),
        } as unknown as Response;
      }
      const m = /edgar\/data\/(\d+)\//.exec(url);
      const cik = m?.[1];
      if (cik === "5000002") {
        return {
          status: 503,
          headers: { get: () => "text/plain" },
          text: async () => "unavailable",
          json: async () => ({}),
        } as unknown as Response;
      }
      const hit = cik ? byCik.get(cik) : undefined;
      return {
        status: 200,
        headers: { get: () => "application/xml" },
        text: async () => buildFormDXml(hit!),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const result = await secFormDAdapter(makeCtx());
    expect(result.candidates.length).toBe(1);
    expect(result.candidates[0]!.rawPayload.entityName).toBe("GOOD CO");
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
