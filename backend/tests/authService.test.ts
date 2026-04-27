import jwt from "jsonwebtoken";
import {
  generateToken,
  hashPassword,
  verifyPassword,
  verifyToken,
} from "../src/services/authService";

describe("authService", () => {
  describe("hashPassword / verifyPassword", () => {
    it("hashes and verifies a correct password", async () => {
      const hash = await hashPassword("superSecret123");
      expect(hash).not.toBe("superSecret123");
      expect(hash).toMatch(/^\$2[aby]\$/);
      await expect(verifyPassword("superSecret123", hash)).resolves.toBe(true);
    });

    it("rejects an incorrect password", async () => {
      const hash = await hashPassword("superSecret123");
      await expect(verifyPassword("wrong-password", hash)).resolves.toBe(false);
    });

    it("produces different hashes for the same input (salt)", async () => {
      const a = await hashPassword("samePassword!");
      const b = await hashPassword("samePassword!");
      expect(a).not.toBe(b);
    });
  });

  describe("generateToken / verifyToken", () => {
    it("round-trips userId and email through the JWT", () => {
      const token = generateToken("user-1", "a@b.com");
      const payload = verifyToken(token);
      expect(payload.userId).toBe("user-1");
      expect(payload.email).toBe("a@b.com");
    });

    it("throws on tampered tokens", () => {
      const token = generateToken("user-1", "a@b.com");
      const tampered = token.slice(0, -4) + "abcd";
      expect(() => verifyToken(tampered)).toThrow();
    });

    it("throws on tokens signed with a different secret", () => {
      const token = jwt.sign({ userId: "x", email: "y@z.com" }, "other-secret-nobodyknows");
      expect(() => verifyToken(token)).toThrow();
    });

    it("throws on expired tokens", () => {
      const token = jwt.sign(
        { userId: "x", email: "y@z.com" },
        process.env.JWT_SECRET as string,
        { expiresIn: -1 },
      );
      expect(() => verifyToken(token)).toThrow();
    });
  });
});
