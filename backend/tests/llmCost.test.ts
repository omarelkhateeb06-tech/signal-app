import {
  LLM_COST_LOG_TAG,
  LLM_PRICING,
  buildUsageRecord,
  computeCostUsd,
  logLlmUsage,
  type LlmUsageRecord,
} from "../src/lib/llmCost";

describe("computeCostUsd", () => {
  it("prices Haiku input + output at the §19 rates", () => {
    // 1M input @ $1 + 1M output @ $5 = $6.
    expect(computeCostUsd("claude-haiku-4-5-20251001", 1_000_000, 1_000_000)).toBeCloseTo(6, 10);
  });

  it("prices a realistic small commentary call", () => {
    // 1,200 in + 300 out → 1200/1e6*1 + 300/1e6*5 = 0.0012 + 0.0015 = 0.0027.
    expect(computeCostUsd("claude-haiku-4-5-20251001", 1_200, 300)).toBeCloseTo(0.0027, 10);
  });

  it("prices embeddings as input-only", () => {
    expect(computeCostUsd("text-embedding-3-small", 1_000_000, 0)).toBeCloseTo(0.02, 10);
  });

  it("returns 0 for an unknown model rather than throwing", () => {
    expect(computeCostUsd("gpt-9-ultra", 5000, 5000)).toBe(0);
  });

  it("clamps negative token counts to 0", () => {
    expect(computeCostUsd("claude-haiku-4-5-20251001", -100, -100)).toBe(0);
  });
});

describe("buildUsageRecord", () => {
  it("flags priced models and rounds the cost", () => {
    const rec = buildUsageRecord({
      provider: "anthropic",
      callSite: "commentary",
      model: "claude-haiku-4-5-20251001",
      inputTokens: 1_200,
      outputTokens: 300,
    });
    expect(rec.priced).toBe(true);
    expect(rec.costUsd).toBeCloseTo(0.0027, 10);
  });

  it("marks an unpriced model with priced:false and costUsd 0", () => {
    const rec = buildUsageRecord({
      provider: "openai",
      callSite: "embedding",
      model: "text-embedding-9-huge",
      inputTokens: 500,
      outputTokens: 0,
    });
    expect(rec.priced).toBe(false);
    expect(rec.costUsd).toBe(0);
  });
});

describe("logLlmUsage", () => {
  const realLog = console.log;
  let lines: string[];

  beforeEach(() => {
    lines = [];
    // eslint-disable-next-line no-console
    console.log = (msg?: unknown) => {
      lines.push(String(msg));
    };
    delete process.env.LLM_COST_LOG;
  });

  afterEach(() => {
    // eslint-disable-next-line no-console
    console.log = realLog;
    delete process.env.LLM_COST_LOG;
  });

  it("emits one tagged, JSON-parseable spend line", () => {
    logLlmUsage({
      provider: "anthropic",
      callSite: "tier:accessible",
      model: "claude-haiku-4-5-20251001",
      inputTokens: 1_000,
      outputTokens: 200,
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]!.startsWith(`${LLM_COST_LOG_TAG} `)).toBe(true);
    const parsed = JSON.parse(lines[0]!.slice(LLM_COST_LOG_TAG.length + 1)) as LlmUsageRecord;
    expect(parsed.callSite).toBe("tier:accessible");
    expect(parsed.costUsd).toBeCloseTo(0.002, 10);
    expect(parsed.priced).toBe(true);
  });

  it("is suppressed when LLM_COST_LOG=0", () => {
    process.env.LLM_COST_LOG = "0";
    logLlmUsage({
      provider: "anthropic",
      callSite: "commentary",
      model: "claude-haiku-4-5-20251001",
      inputTokens: 1_000,
      outputTokens: 200,
    });
    expect(lines).toHaveLength(0);
  });

  it("never throws on a circular / unserializable payload", () => {
    const circular = { provider: "anthropic", callSite: "x", model: "m" } as unknown as {
      inputTokens: number;
      outputTokens: number;
      provider: "anthropic";
      callSite: string;
      model: string;
    };
    // Force JSON.stringify to throw via a getter.
    Object.defineProperty(circular, "inputTokens", {
      get() {
        throw new Error("boom");
      },
      enumerable: true,
    });
    Object.defineProperty(circular, "outputTokens", { value: 0, enumerable: true });
    expect(() => logLlmUsage(circular)).not.toThrow();
  });
});

describe("LLM_PRICING", () => {
  it("carries the two Haiku pins and the embedding model", () => {
    expect(LLM_PRICING["claude-haiku-4-5-20251001"]).toBeDefined();
    expect(LLM_PRICING["claude-haiku-4-5"]).toBeDefined();
    expect(LLM_PRICING["text-embedding-3-small"]).toBeDefined();
  });
});
