/* eslint-disable @typescript-eslint/no-explicit-any */
import { callHaikuForFacts } from "../../src/services/haikuFactsClient";
import { FACTS_DEFAULT_MAX_TOKENS } from "../../src/llm/prompts/ingestion/factExtraction";

// Mock callHaikuForCommentary so we can assert on the args the wrapper passes.
const mockCallHaiku = jest.fn();
jest.mock("../../src/services/haikuCommentaryClient", () => ({
  callHaikuForCommentary: (...args: unknown[]) => mockCallHaiku(...args),
}));

describe("callHaikuForFacts", () => {
  beforeEach(() => {
    mockCallHaiku.mockReset();
    mockCallHaiku.mockResolvedValue({
      ok: true,
      text: '{"facts":[{"text":"x","category":"actor"}]}',
    });
  });

  it('defaults assistantPrefill to "{"', async () => {
    await callHaikuForFacts("prompt");
    expect(mockCallHaiku).toHaveBeenCalledTimes(1);
    const callArgs = mockCallHaiku.mock.calls[0]!;
    expect(callArgs[2].assistantPrefill).toBe("{");
  });

  it("defaults maxTokens to 800", async () => {
    await callHaikuForFacts("prompt");
    const callArgs = mockCallHaiku.mock.calls[0]!;
    expect(callArgs[2].maxTokens).toBe(FACTS_DEFAULT_MAX_TOKENS);
    expect(callArgs[2].maxTokens).toBe(800);
  });

  it("forwards prompt text verbatim", async () => {
    await callHaikuForFacts("the actual prompt body");
    const callArgs = mockCallHaiku.mock.calls[0]!;
    expect(callArgs[0]).toBe("the actual prompt body");
  });

  it("allows overriding assistantPrefill", async () => {
    await callHaikuForFacts("prompt", { assistantPrefill: '{"facts":' });
    const callArgs = mockCallHaiku.mock.calls[0]!;
    expect(callArgs[2].assistantPrefill).toBe('{"facts":');
  });

  it("allows overriding maxTokens", async () => {
    await callHaikuForFacts("prompt", { maxTokens: 400 });
    const callArgs = mockCallHaiku.mock.calls[0]!;
    expect(callArgs[2].maxTokens).toBe(400);
  });

  it("allows overriding timeoutMs through deps", async () => {
    await callHaikuForFacts("prompt", { timeoutMs: 5000 });
    const callArgs = mockCallHaiku.mock.calls[0]!;
    expect(callArgs[1].timeoutMs).toBe(5000);
  });

  it("returns the underlying client's discriminated-union result verbatim", async () => {
    mockCallHaiku.mockResolvedValueOnce({ ok: false, reason: "timeout" });
    const result = await callHaikuForFacts("prompt");
    expect(result).toEqual({ ok: false, reason: "timeout" });
  });
});
