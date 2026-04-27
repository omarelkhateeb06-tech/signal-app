import {
  generateApiKey,
  hashApiKey,
  verifyApiKey,
} from "../src/services/apiKeyService";

// Obviously-fake fixture. The TEST_FIXTURE_ infix and repeated "NOT_A_REAL_
// KEY" body keep secret scanners from tripping on these literals. Length
// (43 chars after the prefix) matches the production shape so prefix/
// length assertions stay meaningful.
const FAKE_KEY = "sgnl_live_TEST_FIXTURE_NOT_A_REAL_KEY_abcde_xyz0";

describe("apiKeyService", () => {
  describe("generateApiKey", () => {
    it("returns a full key, prefix, and hex hash of the expected shapes", () => {
      const { fullKey, keyPrefix, keyHash } = generateApiKey();
      expect(fullKey).toMatch(/^sgnl_live_[A-Za-z0-9_-]{43}$/);
      expect(fullKey).toHaveLength(53);
      expect(keyPrefix).toHaveLength(14);
      expect(fullKey.startsWith(keyPrefix)).toBe(true);
      expect(keyHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("produces distinct keys across calls", () => {
      const a = generateApiKey();
      const b = generateApiKey();
      expect(a.fullKey).not.toEqual(b.fullKey);
      expect(a.keyHash).not.toEqual(b.keyHash);
    });

    it("honors API_KEY_PREFIX override (e.g. sgnl_test_)", () => {
      const prev = process.env.API_KEY_PREFIX;
      process.env.API_KEY_PREFIX = "sgnl_test_";
      try {
        const { fullKey } = generateApiKey();
        expect(fullKey.startsWith("sgnl_test_")).toBe(true);
      } finally {
        if (prev === undefined) delete process.env.API_KEY_PREFIX;
        else process.env.API_KEY_PREFIX = prev;
      }
    });
  });

  describe("hashApiKey", () => {
    it("is deterministic for the same input", () => {
      expect(hashApiKey(FAKE_KEY)).toBe(hashApiKey(FAKE_KEY));
    });

    it("differs when the secret changes (fresh module import)", async () => {
      const a = hashApiKey(FAKE_KEY);

      const prev = process.env.API_KEY_HASH_SECRET;
      process.env.API_KEY_HASH_SECRET = "a-completely-different-hmac-secret-32chars";
      try {
        jest.resetModules();
        const { hashApiKey: hashFresh } = await import("../src/services/apiKeyService");
        expect(hashFresh(FAKE_KEY)).not.toBe(a);
      } finally {
        if (prev !== undefined) process.env.API_KEY_HASH_SECRET = prev;
      }
    });

    it("throws when API_KEY_HASH_SECRET is missing on a fresh import", async () => {
      const prev = process.env.API_KEY_HASH_SECRET;
      delete process.env.API_KEY_HASH_SECRET;
      try {
        jest.resetModules();
        const { hashApiKey: hashFresh } = await import("../src/services/apiKeyService");
        expect(() => hashFresh("sgnl_live_TEST_FIXTURE_short")).toThrow(
          /API_KEY_HASH_SECRET/,
        );
      } finally {
        if (prev !== undefined) process.env.API_KEY_HASH_SECRET = prev;
      }
    });
  });

  describe("verifyApiKey", () => {
    it("returns true for a matching key/hash pair", () => {
      const { fullKey, keyHash } = generateApiKey();
      expect(verifyApiKey(fullKey, keyHash)).toBe(true);
    });

    it("returns false for a mismatched candidate", () => {
      const a = generateApiKey();
      const b = generateApiKey();
      expect(verifyApiKey(a.fullKey, b.keyHash)).toBe(false);
    });

    it("returns false when the stored hash is malformed (length mismatch)", () => {
      const { fullKey } = generateApiKey();
      expect(verifyApiKey(fullKey, "deadbeef")).toBe(false);
    });
  });
});
