import {
  CORROBORATION_CAP,
  calculateSignalRating,
} from "../../src/feed/signalRating";

describe("calculateSignalRating", () => {
  it("scores a top-tier lab source, uncorroborated", () => {
    // quality 9 → 63, tier 1 → +24, no alternates → 87.
    expect(
      calculateSignalRating({ quality: 9, priority: 1, alternates: 0 }),
    ).toBe(87);
  });

  it("rewards corroboration up to the cap", () => {
    // quality 9 → 63, tier 1 → +24, 3 alternates → +12 (cap) → 99.
    expect(
      calculateSignalRating({ quality: 9, priority: 1, alternates: 3 }),
    ).toBe(99);
    // 10 alternates is still capped at +12 → same as 3.
    expect(
      calculateSignalRating({ quality: 9, priority: 1, alternates: 10 }),
    ).toBe(99);
  });

  it("scores mid-tier news lower than a lab", () => {
    // quality 6 → 42, tier 3 → +8, solo → 50.
    expect(
      calculateSignalRating({ quality: 6, priority: 3, alternates: 0 }),
    ).toBe(50);
  });

  it("scores a solo community post low", () => {
    // quality 4 → 28, tier 4 → +0, solo → 28.
    expect(
      calculateSignalRating({ quality: 4, priority: 4, alternates: 0 }),
    ).toBe(28);
  });

  it("clamps the score to 100", () => {
    expect(
      calculateSignalRating({ quality: 10, priority: 1, alternates: 5 }),
    ).toBe(100);
  });

  it("clamps out-of-range priority into [1,4]", () => {
    // priority 0 behaves as tier 1; priority 9 behaves as tier 4.
    expect(calculateSignalRating({ quality: 5, priority: 0, alternates: 0 })).toBe(
      calculateSignalRating({ quality: 5, priority: 1, alternates: 0 }),
    );
    expect(calculateSignalRating({ quality: 5, priority: 9, alternates: 0 })).toBe(
      calculateSignalRating({ quality: 5, priority: 4, alternates: 0 }),
    );
  });

  it("treats negative alternates as zero corroboration", () => {
    expect(
      calculateSignalRating({ quality: 6, priority: 3, alternates: -5 }),
    ).toBe(50);
  });

  it("never exceeds the corroboration cap contribution", () => {
    const solo = calculateSignalRating({ quality: 5, priority: 4, alternates: 0 });
    const flooded = calculateSignalRating({
      quality: 5,
      priority: 4,
      alternates: 999,
    });
    expect(flooded - solo).toBe(CORROBORATION_CAP);
  });
});
