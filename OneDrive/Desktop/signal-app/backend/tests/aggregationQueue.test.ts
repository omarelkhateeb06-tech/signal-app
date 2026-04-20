jest.mock("../src/lib/redis", () => ({
  __esModule: true,
  getRedis: () => null,
  isRedisConfigured: () => false,
  getRedisUrl: () => null,
  closeRedis: async () => undefined,
}));

import {
  AGGREGATION_QUEUE_NAME,
  AGGREGATION_JOB_NAME,
  AGGREGATION_CRON_PATTERN,
  enqueueAggregation,
  getAggregationQueue,
  scheduleAggregationRepeatable,
  __resetAggregationQueueForTests,
} from "../src/jobs/aggregationQueue";

describe("aggregationQueue graceful degradation", () => {
  let consoleWarn: jest.SpyInstance;

  beforeEach(() => {
    __resetAggregationQueueForTests();
    consoleWarn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleWarn.mockRestore();
  });

  it("exposes stable queue/job/cron identifiers", () => {
    expect(AGGREGATION_QUEUE_NAME).toBe("signal-aggregation");
    expect(AGGREGATION_JOB_NAME).toBe("compute-sector-weekly");
    // Default daily pattern unless overridden — matches Phase 11c.5 contract.
    expect(AGGREGATION_CRON_PATTERN).toBe("0 2 * * *");
  });

  it("getAggregationQueue returns null when Redis is not configured", () => {
    expect(getAggregationQueue()).toBeNull();
  });

  it("enqueueAggregation returns { queued: false } and warns without Redis", async () => {
    const result = await enqueueAggregation({ period: "2026-W16" });
    expect(result).toEqual({ queued: false });
    expect(consoleWarn).toHaveBeenCalled();
  });

  it("scheduleAggregationRepeatable returns false and warns without Redis", async () => {
    const ok = await scheduleAggregationRepeatable();
    expect(ok).toBe(false);
    expect(consoleWarn).toHaveBeenCalled();
  });
});
