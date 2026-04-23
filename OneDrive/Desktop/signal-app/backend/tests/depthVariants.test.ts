import {
  WhyItMattersTemplateSchema,
  parseWhyItMattersTemplate,
  assertWhyItMattersTemplate,
} from "../src/utils/depthVariants";

describe("depthVariants utility", () => {
  const valid = {
    accessible: "Plain-English framing.",
    standard: "Working-professional framing.",
    technical: "Insider framing.",
  };

  describe("WhyItMattersTemplateSchema", () => {
    it("accepts exactly the three depth keys", () => {
      expect(WhyItMattersTemplateSchema.safeParse(valid).success).toBe(true);
    });

    it("rejects the pre-12a sector-variant shape outright", () => {
      const legacy = { ai: "a", finance: "b", semiconductors: "c" };
      expect(WhyItMattersTemplateSchema.safeParse(legacy).success).toBe(false);
    });

    it("rejects empty strings", () => {
      expect(
        WhyItMattersTemplateSchema.safeParse({ ...valid, standard: "" }).success,
      ).toBe(false);
    });

    it("rejects extra keys via .strict()", () => {
      const extra = { ...valid, expert: "extra" };
      expect(WhyItMattersTemplateSchema.safeParse(extra).success).toBe(false);
    });
  });

  describe("parseWhyItMattersTemplate (lenient-on-read)", () => {
    it("parses a well-formed JSON string", () => {
      expect(parseWhyItMattersTemplate(JSON.stringify(valid))).toEqual(valid);
    });

    it("returns null for a null or empty column", () => {
      expect(parseWhyItMattersTemplate(null)).toBeNull();
      expect(parseWhyItMattersTemplate("")).toBeNull();
      expect(parseWhyItMattersTemplate(undefined)).toBeNull();
    });

    it("returns null for invalid JSON (does not throw)", () => {
      expect(parseWhyItMattersTemplate("{not json")).toBeNull();
    });

    it("returns null for a legacy sector-variant payload (does not throw)", () => {
      const legacy = JSON.stringify({ ai: "a", finance: "b", semiconductors: "c" });
      expect(parseWhyItMattersTemplate(legacy)).toBeNull();
    });
  });

  describe("assertWhyItMattersTemplate (strict, used in the regeneration path)", () => {
    it("returns the typed value for a valid payload", () => {
      expect(assertWhyItMattersTemplate(valid)).toEqual(valid);
    });

    it("throws on an invalid payload (used at the regeneration boundary)", () => {
      expect(() => assertWhyItMattersTemplate({ accessible: "x" })).toThrow();
    });
  });
});
