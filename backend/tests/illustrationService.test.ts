// Phase C — illustrationService unit tests.
//
// The service wraps the @higgsfield/client v2 SDK + a Drizzle UPDATE. Tests
// mock the SDK at the module boundary and verify:
//   1. resolveArchetype maps every registered slug correctly.
//   2. generateAndStoreIllustration returns null + skips the SDK when key unset.
//   3. generateAndStoreIllustration calls subscribe and stores on success.
//   4. generateAndStoreIllustration soft-fails (returns null) on SDK error,
//      incomplete job, or missing URL.

const mockSubscribe = jest.fn();
const mockConfig = jest.fn();

jest.mock("@higgsfield/client/v2", () => ({
  config: (...args: unknown[]) => mockConfig(...args),
  higgsfield: { subscribe: (...args: unknown[]) => mockSubscribe(...args) },
}));

import {
  generateAndStoreIllustration,
  resolveArchetype,
} from "../src/services/illustrationService";

// ── resolveArchetype ─────────────────────────────────────────────────────

describe("resolveArchetype", () => {
  it("maps cross-sector-chain-native → convergence", () => {
    expect(resolveArchetype("cross-sector-chain-native")).toBe("convergence");
  });
  it("maps arxiv-synthesis-native → research", () => {
    expect(resolveArchetype("arxiv-synthesis-native")).toBe("research");
  });
  it("maps earnings-reaction-native → market", () => {
    expect(resolveArchetype("earnings-reaction-native")).toBe("market");
  });
  it("maps supply-chain-synthesis-native → market", () => {
    expect(resolveArchetype("supply-chain-synthesis-native")).toBe("market");
  });
  it("maps github-trending-native → signal", () => {
    expect(resolveArchetype("github-trending-native")).toBe("signal");
  });
  it("maps tool-spotlight-native → signal", () => {
    expect(resolveArchetype("tool-spotlight-native")).toBe("signal");
  });
  it("maps hn-synthesis-native → signal", () => {
    expect(resolveArchetype("hn-synthesis-native")).toBe("signal");
  });
  it("returns signal for unknown slugs", () => {
    expect(resolveArchetype("unknown-slug")).toBe("signal");
  });
});

// ── generateAndStoreIllustration ─────────────────────────────────────────

const FAKE_URL = "https://img.higgsfield.ai/generated/test-image.png";

const mockUpdate = jest.fn().mockReturnValue({
  set: jest.fn().mockReturnValue({
    where: jest.fn().mockResolvedValue([]),
  }),
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockDb = { update: mockUpdate } as any;

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.HIGGSFIELD_API_KEY;
});

describe("generateAndStoreIllustration — key unset", () => {
  it("returns null without calling the SDK", async () => {
    const result = await generateAndStoreIllustration(
      "event-1",
      "cross-sector-chain-native",
      { db: mockDb },
    );
    expect(result).toBeNull();
    expect(mockSubscribe).not.toHaveBeenCalled();
  });
});

describe("generateAndStoreIllustration — key set", () => {
  beforeEach(() => {
    process.env.HIGGSFIELD_API_KEY = "kid:secret";
  });

  it("returns result + writes URL on a completed job", async () => {
    mockSubscribe.mockResolvedValue({
      isCompleted: true,
      jobs: [{ status: "completed", results: { raw: { url: FAKE_URL } } }],
    });

    const result = await generateAndStoreIllustration(
      "event-1",
      "cross-sector-chain-native",
      { db: mockDb },
    );

    expect(result).toEqual({ url: FAKE_URL, archetype: "convergence" });
    expect(mockSubscribe).toHaveBeenCalledWith(
      expect.stringContaining("text-to-image"),
      expect.objectContaining({ withPolling: true }),
    );
    expect(mockUpdate).toHaveBeenCalled();
  });

  it("returns null when the job did not complete (soft-fail)", async () => {
    mockSubscribe.mockResolvedValue({
      isCompleted: false,
      jobs: [{ status: "failed" }],
    });

    const result = await generateAndStoreIllustration(
      "event-2",
      "arxiv-synthesis-native",
      { db: mockDb },
    );

    expect(result).toBeNull();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("returns null when the SDK throws, e.g. out of credits (soft-fail)", async () => {
    mockSubscribe.mockRejectedValue(new Error("Not enough credits"));

    const result = await generateAndStoreIllustration(
      "event-3",
      "github-trending-native",
      { db: mockDb },
    );

    expect(result).toBeNull();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("returns null when a completed job has no image URL (soft-fail)", async () => {
    mockSubscribe.mockResolvedValue({
      isCompleted: true,
      jobs: [{ status: "completed", results: { raw: {} } }],
    });

    const result = await generateAndStoreIllustration(
      "event-4",
      "supply-chain-synthesis-native",
      { db: mockDb },
    );

    expect(result).toBeNull();
  });
});
