/* eslint-disable @typescript-eslint/no-explicit-any */
import { callHaikuForRelevance, RELEVANCE_DEFAULT_MAX_TOKENS } from "../../src/services/haikuRelevanceClient";

// Mock callHaikuForCommentary so we can assert on the args the wrapper passes.
const mockCallHaiku = jest.fn();
jest.mock("../../src/services/haikuCommentaryClient", () => ({
  callHaikuForCommentary: (...args: unknown[]) => mockCallHaiku(...args),
}));

describe("callHaikuForRelevance", () => {
  beforeEach(() => {
    mockCallHaiku.mockReset();
    mockCallHaiku.mockResolvedValue({ ok: true, text: '{"relevant":true,"sector":"ai","reason":"x"}' });
  });

  it('defaults assistantPrefill to "{"', async () => {
    await callHaikuForRelevance("prompt");
    expect(mockCallHaiku).toHaveBeenCalledTimes(1);
    const callArgs = mockCallHaiku.mock.calls[0]!;
    expect(callArgs[2].assistantPrefill).toBe("{");
  });

  it("defaults maxTokens to 400", async () => {
    await callHaikuForRelevance("prompt");
    const callArgs = mockCallHaiku.mock.calls[0]!;
    expect(callArgs[2].maxTokens).toBe(RELEVANCE_DEFAULT_MAX_TOKENS);
    expect(callArgs[2].maxTokens).toBe(400);
  });

  it("forwards prompt text verbatim", async () => {
    await callHaikuForRelevance("the actual prompt body");
    const callArgs = mockCallHaiku.mock.calls[0]!;
    expect(callArgs[0]).toBe("the actual prompt body");
  });

  it("allows overriding assistantPrefill", async () => {
    await callHaikuForRelevance("prompt", { assistantPrefill: '{"relevant":' });
    const callArgs = mockCallHaiku.mock.calls[0]!;
    expect(callArgs[2].assistantPrefill).toBe('{"relevant":');
  });

  it("allows overriding maxTokens", async () => {
    await callHaikuForRelevance("prompt", { maxTokens: 200 });
    const callArgs = mockCallHaiku.mock.calls[0]!;
    expect(callArgs[2].maxTokens).toBe(200);
  });

  it("allows overriding timeoutMs through deps", async () => {
    await callHaikuForRelevance("prompt", { timeoutMs: 5000 });
    const callArgs = mockCallHaiku.mock.calls[0]!;
    expect(callArgs[1].timeoutMs).toBe(5000);
  });

  it("returns the underlying client's discriminated-union result verbatim", async () => {
    mockCallHaiku.mockResolvedValueOnce({ ok: false, reason: "timeout" });
    const result = await callHaikuForRelevance("prompt");
    expect(result).toEqual({ ok: false, reason: "timeout" });
  });
});
