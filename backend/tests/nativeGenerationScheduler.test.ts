// Phase 12u — native generation scheduler unit test.
//
// Mirrors the emailScheduler contract (cadence-only node-cron wrapper):
// registers a task when enabled + cron is valid; skips when
// DISABLE_NATIVE_SCHEDULER=1 or the cron is invalid. The scheduled callback
// is exercised separately for its ANTHROPIC_API_KEY graceful-skip and its
// delegation to runNativeGeneration. node-cron and the generation service are
// both mocked so nothing touches Postgres / Anthropic.

type CronCallback = () => void | Promise<void>;

const scheduleMock = jest.fn();
const validateMock = jest.fn();

jest.mock("node-cron", () => ({
  __esModule: true,
  default: {
    schedule: (...args: unknown[]) => scheduleMock(...args),
    validate: (...args: unknown[]) => validateMock(...args),
  },
  schedule: (...args: unknown[]) => scheduleMock(...args),
  validate: (...args: unknown[]) => validateMock(...args),
}));

const runNativeGenerationMock = jest.fn();

jest.mock("../src/services/nativeGenerationService", () => ({
  __esModule: true,
  NATIVE_DAILY_CAP: 25,
  runNativeGeneration: (...args: unknown[]) => runNativeGenerationMock(...args),
}));

import {
  startNativeGenerationScheduler,
  stopNativeGenerationScheduler,
} from "../src/jobs/nativeGenerationScheduler";

describe("nativeGenerationScheduler", () => {
  const fakeTask = { stop: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    stopNativeGenerationScheduler();
    delete process.env.DISABLE_NATIVE_SCHEDULER;
    delete process.env.NATIVE_GENERATION_CRON;
    validateMock.mockReturnValue(true);
    scheduleMock.mockReturnValue(fakeTask);
    jest.spyOn(console, "log").mockImplementation(() => undefined);
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    stopNativeGenerationScheduler();
    jest.restoreAllMocks();
  });

  it("registers a cron task with the default schedule when enabled", () => {
    const task = startNativeGenerationScheduler();
    expect(task).toBe(fakeTask);
    expect(scheduleMock).toHaveBeenCalledTimes(1);
    expect(scheduleMock).toHaveBeenCalledWith(
      "0 9 * * *",
      expect.any(Function),
      { timezone: "UTC" },
    );
  });

  it("skips registration when DISABLE_NATIVE_SCHEDULER=1", () => {
    process.env.DISABLE_NATIVE_SCHEDULER = "1";
    const task = startNativeGenerationScheduler();
    expect(task).toBeNull();
    expect(scheduleMock).not.toHaveBeenCalled();
  });

  it("skips registration when the cron expression is invalid", () => {
    validateMock.mockReturnValue(false);
    process.env.NATIVE_GENERATION_CRON = "not-a-cron";
    const task = startNativeGenerationScheduler();
    expect(task).toBeNull();
    expect(scheduleMock).not.toHaveBeenCalled();
  });

  it("memoizes the task across repeated start calls", () => {
    startNativeGenerationScheduler();
    startNativeGenerationScheduler();
    expect(scheduleMock).toHaveBeenCalledTimes(1);
  });

  describe("scheduled callback", () => {
    function getCallback(): CronCallback {
      startNativeGenerationScheduler();
      const call = scheduleMock.mock.calls[0];
      return call[1] as CronCallback;
    }

    it("skips the run and does not call the service when ANTHROPIC_API_KEY is unset", async () => {
      delete process.env.ANTHROPIC_API_KEY;
      const cb = getCallback();
      await cb();
      expect(runNativeGenerationMock).not.toHaveBeenCalled();
    });

    it("invokes runNativeGeneration when ANTHROPIC_API_KEY is present", async () => {
      process.env.ANTHROPIC_API_KEY = "sk-test";
      runNativeGenerationMock.mockResolvedValue({
        generatorsRun: 2,
        candidatesAuthored: 3,
        published: 3,
        statusCounts: { published: 3 },
        capExhausted: false,
        cap: { used: 3, remaining: 22 },
      });
      const cb = getCallback();
      await cb();
      expect(runNativeGenerationMock).toHaveBeenCalledTimes(1);
      delete process.env.ANTHROPIC_API_KEY;
    });

    it("does not throw when the generation run rejects (scheduler must survive)", async () => {
      process.env.ANTHROPIC_API_KEY = "sk-test";
      runNativeGenerationMock.mockRejectedValue(new Error("haiku exploded"));
      const cb = getCallback();
      await expect(cb()).resolves.toBeUndefined();
      delete process.env.ANTHROPIC_API_KEY;
    });
  });
});
