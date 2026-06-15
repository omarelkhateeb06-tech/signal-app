import { describe, it, expect } from "vitest";
import type { Story } from "@/types/story";
import { nativeSynthesisBody, signalRatingTone } from "./swissView";

// nativeSynthesisBody only reads `kind` + `context`; a partial cast keeps the
// fixture to the fields under test.
function story(partial: Partial<Story>): Story {
  return { kind: "ingested", context: "" , ...partial } as Story;
}

describe("nativeSynthesisBody", () => {
  it("returns the trimmed synthesis body for a native post", () => {
    expect(
      nativeSynthesisBody(
        story({ kind: "native", context: "  Full editorial synthesis paragraph.  " }),
      ),
    ).toBe("Full editorial synthesis paragraph.");
  });

  it("returns null for ingested stories (context is a source summary, not SIGNAL's writing)", () => {
    expect(
      nativeSynthesisBody(story({ kind: "ingested", context: "Source article summary." })),
    ).toBeNull();
  });

  it("returns null when a native post has an empty body", () => {
    expect(nativeSynthesisBody(story({ kind: "native", context: "   " }))).toBeNull();
  });
});

describe("signalRatingTone", () => {
  it("bands the score at the documented thresholds", () => {
    expect(signalRatingTone(87).label).toBe("High");
    expect(signalRatingTone(80).label).toBe("High");
    expect(signalRatingTone(79).label).toBe("Solid");
    expect(signalRatingTone(60).label).toBe("Solid");
    expect(signalRatingTone(59).label).toBe("Mixed");
    expect(signalRatingTone(40).label).toBe("Mixed");
    expect(signalRatingTone(39).label).toBe("Low");
    expect(signalRatingTone(0).label).toBe("Low");
  });

  it("tints only high credibility with the accent", () => {
    expect(signalRatingTone(90).cls).toContain("accent");
    expect(signalRatingTone(30).cls).not.toContain("accent");
  });
});
