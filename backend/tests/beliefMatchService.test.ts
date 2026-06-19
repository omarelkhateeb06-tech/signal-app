// Mock the Anthropic SDK at the module boundary (same seam the other Haiku
// suites use) so the matcher's real client path runs offline. The lazy
// client is reset per-test via __resetBeliefMatchClientForTests.
const createMock = jest.fn();
jest.mock("@anthropic-ai/sdk", () => {
  class Anthropic {
    public messages = {
      create: (...args: unknown[]): unknown => createMock(...args),
    };
  }
  return { __esModule: true, default: Anthropic };
});

import {
  buildBeliefMatchPrompt,
  isoWeekKey,
  matchBeliefAgainstEvents,
  type BeliefMatchInput,
} from "../src/services/beliefMatchService";
import { __resetBeliefMatchClientForTests } from "../src/services/beliefMatchClient";

function haikuText(text: string): { content: { type: string; text: string }[] } {
  return { content: [{ type: "text", text }] };
}

const input: BeliefMatchInput = {
  belief: { statement: "Transformer scaling keeps winning", sector: "ai" },
  events: [
    {
      id: "e1",
      headline: "Sub-quadratic model beats GPT-4 at a tenth the compute",
      gist: "A state-space architecture matches frontier quality far cheaper.",
    },
    { id: "e2", headline: "Fed holds rates", gist: "No change this meeting." },
  ],
};

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key";
});

describe("beliefMatchService", () => {
  beforeEach(() => {
    createMock.mockReset();
    __resetBeliefMatchClientForTests();
  });

  describe("isoWeekKey", () => {
    it("formats as YYYY-Www", () => {
      expect(isoWeekKey(new Date("2026-06-18T12:00:00Z"))).toMatch(/^\d{4}-W\d{2}$/);
    });

    it("is stable within a week and changes across weeks", () => {
      const mon = isoWeekKey(new Date("2026-06-15T00:00:00Z"));
      const fri = isoWeekKey(new Date("2026-06-19T23:00:00Z"));
      const nextWeek = isoWeekKey(new Date("2026-06-29T00:00:00Z"));
      expect(mon).toBe(fri);
      expect(mon).not.toBe(nextWeek);
    });
  });

  describe("buildBeliefMatchPrompt", () => {
    it("omits the falsifier line when the position has none", () => {
      const prompt = buildBeliefMatchPrompt(input);
      expect(prompt).not.toContain("proven wrong if");
    });

    it("includes the falsifier as a strong signal when present", () => {
      const prompt = buildBeliefMatchPrompt({
        ...input,
        belief: {
          ...input.belief,
          whatWouldBreakIt:
            "A cheaper non-transformer architecture matches frontier quality",
        },
      });
      expect(prompt).toContain("proven wrong if");
      expect(prompt).toContain("non-transformer architecture");
    });
  });

  describe("buildBeliefMatchPrompt", () => {
    it("includes the belief, the numbered events, and the relevance contract", () => {
      const p = buildBeliefMatchPrompt(input);
      expect(p).toContain("Transformer scaling keeps winning");
      expect(p).toContain("1. Sub-quadratic model beats GPT-4");
      expect(p).toContain("2. Fed holds rates");
      expect(p).toContain("relevance");
    });
  });

  describe("matchBeliefAgainstEvents", () => {
    it("returns a loud verdict when the model flags a contradiction", async () => {
      createMock.mockResolvedValueOnce(
        haikuText(
          '{"relevance":"contradicts","event_index":1,"read":"Treat sub-quadratic architectures as a live threat to the scaling thesis.","dissent":"One benchmark is not a paradigm shift."}',
        ),
      );
      const v = await matchBeliefAgainstEvents(input);
      expect(v).not.toBeNull();
      expect(v?.relevance).toBe("contradicts");
      expect(v?.eventIndex).toBe(1);
      expect(v?.read).toContain("sub-quadratic");
      expect(v?.dissent).toContain("benchmark");
    });

    it("returns a radar verdict for a non-contradiction (watch)", async () => {
      createMock.mockResolvedValueOnce(
        haikuText(
          '{"relevance":"watch","event_index":2,"read":"An adjacent macro move worth tracking.","dissent":""}',
        ),
      );
      const v = await matchBeliefAgainstEvents(input);
      expect(v?.relevance).toBe("watch");
      expect(v?.eventIndex).toBe(2);
      expect(v?.read).toContain("adjacent");
      expect(v?.dissent).toBe("");
    });

    it("returns null when relevance is 'none'", async () => {
      createMock.mockResolvedValueOnce(
        haikuText('{"relevance":"none","event_index":null,"read":"","dissent":""}'),
      );
      expect(await matchBeliefAgainstEvents(input)).toBeNull();
    });

    it("fails closed on unparseable output", async () => {
      createMock.mockResolvedValueOnce(haikuText("the model rambled and produced no json"));
      expect(await matchBeliefAgainstEvents(input)).toBeNull();
    });

    it("fails closed on an unknown relevance label", async () => {
      createMock.mockResolvedValueOnce(
        haikuText('{"relevance":"maybe","event_index":1,"read":"x","dissent":""}'),
      );
      expect(await matchBeliefAgainstEvents(input)).toBeNull();
    });

    it("drops a verdict with an empty read", async () => {
      createMock.mockResolvedValueOnce(
        haikuText('{"relevance":"pressures","event_index":1,"read":"   ","dissent":"x"}'),
      );
      expect(await matchBeliefAgainstEvents(input)).toBeNull();
    });

    it("drops a verdict whose event_index is out of range", async () => {
      createMock.mockResolvedValueOnce(
        haikuText('{"relevance":"pressures","event_index":9,"read":"Reconsider it.","dissent":""}'),
      );
      expect(await matchBeliefAgainstEvents(input)).toBeNull();
    });

    it("drops a verdict with a null event_index (no card to point at)", async () => {
      createMock.mockResolvedValueOnce(
        haikuText(
          '{"relevance":"pressures","event_index":null,"read":"Reconsider it.","dissent":""}',
        ),
      );
      expect(await matchBeliefAgainstEvents(input)).toBeNull();
    });

    it("returns null (no client call) when there are no events", async () => {
      const v = await matchBeliefAgainstEvents({ belief: input.belief, events: [] });
      expect(v).toBeNull();
      expect(createMock).not.toHaveBeenCalled();
    });
  });
});
