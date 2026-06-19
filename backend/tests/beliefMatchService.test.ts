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
    it("includes the belief, the numbered events, and the JSON contract", () => {
      const p = buildBeliefMatchPrompt(input);
      expect(p).toContain("Transformer scaling keeps winning");
      expect(p).toContain("1. Sub-quadratic model beats GPT-4");
      expect(p).toContain("2. Fed holds rates");
      expect(p).toContain("challenged");
    });
  });

  describe("matchBeliefAgainstEvents", () => {
    it("returns a verdict when the model flags a material challenge", async () => {
      createMock.mockResolvedValueOnce(
        haikuText(
          '{"challenged":true,"event_index":1,"how_to_update":"Treat sub-quadratic architectures as a live threat to the scaling thesis.","dissent":"One benchmark is not a paradigm shift."}',
        ),
      );
      const v = await matchBeliefAgainstEvents(input);
      expect(v).not.toBeNull();
      expect(v?.eventIndex).toBe(1);
      expect(v?.howToUpdate).toContain("sub-quadratic");
      expect(v?.dissent).toContain("benchmark");
    });

    it("returns null when not challenged", async () => {
      createMock.mockResolvedValueOnce(
        haikuText('{"challenged":false,"event_index":null,"how_to_update":"","dissent":""}'),
      );
      expect(await matchBeliefAgainstEvents(input)).toBeNull();
    });

    it("fails closed on unparseable output", async () => {
      createMock.mockResolvedValueOnce(haikuText("the model rambled and produced no json"));
      expect(await matchBeliefAgainstEvents(input)).toBeNull();
    });

    it("drops a 'challenged' verdict with no substance", async () => {
      createMock.mockResolvedValueOnce(
        haikuText('{"challenged":true,"event_index":1,"how_to_update":"   ","dissent":"x"}'),
      );
      expect(await matchBeliefAgainstEvents(input)).toBeNull();
    });

    it("clamps an out-of-range event_index to null", async () => {
      createMock.mockResolvedValueOnce(
        haikuText('{"challenged":true,"event_index":9,"how_to_update":"Reconsider it.","dissent":""}'),
      );
      const v = await matchBeliefAgainstEvents(input);
      expect(v?.eventIndex).toBeNull();
      expect(v?.howToUpdate).toBe("Reconsider it.");
    });

    it("returns null (no client call) when there are no events", async () => {
      const v = await matchBeliefAgainstEvents({ belief: input.belief, events: [] });
      expect(v).toBeNull();
      expect(createMock).not.toHaveBeenCalled();
    });
  });
});
