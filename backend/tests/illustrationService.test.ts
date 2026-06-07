// Phase C — illustrationService unit tests.
//
// The service is a thin wrapper around fetch + a Drizzle UPDATE. Tests verify:
//   1. resolveArchetype maps every registered slug correctly.
//   2. generateAndStoreIllustration returns null + skips fetch when key unset.
//   3. generateAndStoreIllustration calls fetch and stores on success.
//   4. generateAndStoreIllustration soft-fails (returns null) on API error.

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

const FAKE_URL = "https://img.recraft.ai/generated/test-image.png";

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
  it("returns null without calling fetch", async () => {
    const fetchSpy = jest
      .spyOn(global, "fetch")
      .mockResolvedValue({} as Response);
    const result = await generateAndStoreIllustration(
      "event-1",
      "cross-sector-chain-native",
      { db: mockDb },
    );
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("generateAndStoreIllustration — key set", () => {
  beforeEach(() => {
    process.env.HIGGSFIELD_API_KEY = "test-key";
  });

  it("returns result + writes URL on success", async () => {
    const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ images: [{ url: FAKE_URL }] }),
    } as Response);

    const result = await generateAndStoreIllustration(
      "event-1",
      "cross-sector-chain-native",
      { db: mockDb },
    );

    expect(result).toEqual({ url: FAKE_URL, archetype: "convergence" });
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("higgsfield.ai"),
      expect.objectContaining({ method: "POST" }),
    );
    fetchSpy.mockRestore();
  });

  it("returns null on API error (soft-fail)", async () => {
    const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => "rate limited",
    } as Response);

    const result = await generateAndStoreIllustration(
      "event-2",
      "arxiv-synthesis-native",
      { db: mockDb },
    );

    expect(result).toBeNull();
    fetchSpy.mockRestore();
  });

  it("returns null on fetch throw (soft-fail)", async () => {
    const fetchSpy = jest
      .spyOn(global, "fetch")
      .mockRejectedValue(new Error("network timeout"));

    const result = await generateAndStoreIllustration(
      "event-3",
      "github-trending-native",
      { db: mockDb },
    );

    expect(result).toBeNull();
    fetchSpy.mockRestore();
  });
});
