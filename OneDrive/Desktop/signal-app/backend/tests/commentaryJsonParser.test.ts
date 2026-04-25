import { parseCommentaryJson } from "../src/services/commentaryJsonParser";

describe("parseCommentaryJson", () => {
  it("parses a clean object", () => {
    const r = parseCommentaryJson('{"thesis":"T","support":"S"}');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ thesis: "T", support: "S" });
  });

  it("trims thesis and support", () => {
    const r = parseCommentaryJson('{"thesis":"  T  ","support":"\\nS\\t"}');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ thesis: "T", support: "S" });
  });

  it("strips a ```json ... ``` fence before parsing", () => {
    const r = parseCommentaryJson('```json\n{"thesis":"T","support":"S"}\n```');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ thesis: "T", support: "S" });
  });

  it("strips a generic ``` ... ``` fence too", () => {
    const r = parseCommentaryJson('```\n{"thesis":"T","support":"S"}\n```');
    expect(r.ok).toBe(true);
  });

  it("returns json_parse on malformed JSON", () => {
    const r = parseCommentaryJson("not json at all");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("json_parse");
      expect(r.rawSample).toContain("not json");
    }
  });

  it("returns json_shape with both fields missing on a primitive", () => {
    const r = parseCommentaryJson("42");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("json_shape");
      expect(r.missingFields).toEqual(["thesis", "support"]);
    }
  });

  it("returns json_shape with both fields missing on an array", () => {
    const r = parseCommentaryJson('["thesis","support"]');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("json_shape");
      expect(r.missingFields).toEqual(["thesis", "support"]);
    }
  });

  it("flags a missing thesis field", () => {
    const r = parseCommentaryJson('{"support":"S"}');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("json_shape");
      expect(r.missingFields).toEqual(["thesis"]);
    }
  });

  it("flags a missing support field", () => {
    const r = parseCommentaryJson('{"thesis":"T"}');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("json_shape");
      expect(r.missingFields).toEqual(["support"]);
    }
  });

  it("flags a non-string thesis", () => {
    const r = parseCommentaryJson('{"thesis":1,"support":"S"}');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("json_shape");
      expect(r.missingFields).toEqual(["thesis"]);
    }
  });

  it("flags an empty-after-trim support field", () => {
    const r = parseCommentaryJson('{"thesis":"T","support":"   "}');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("json_shape");
      expect(r.missingFields).toEqual(["support"]);
    }
  });

  it("truncates rawSample to 200 chars with an ellipsis", () => {
    const long = "x".repeat(500);
    const r = parseCommentaryJson(long);
    expect(r.ok).toBe(false);
    if (!r.ok && r.rawSample) {
      expect(r.rawSample.length).toBeLessThanOrEqual(201); // 200 + ellipsis char
      expect(r.rawSample.endsWith("…")).toBe(true);
    }
  });
});
