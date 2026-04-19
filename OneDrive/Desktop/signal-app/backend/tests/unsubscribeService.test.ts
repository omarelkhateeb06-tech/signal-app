import {
  buildUnsubscribeUrl,
  signUnsubscribeToken,
  verifyUnsubscribeToken,
} from "../src/services/unsubscribeService";

describe("unsubscribeService", () => {
  it("round-trips a valid token", () => {
    const token = signUnsubscribeToken("user-123");
    const verified = verifyUnsubscribeToken(token);
    expect(verified?.userId).toBe("user-123");
    expect(typeof verified?.issuedAt).toBe("number");
  });

  it("rejects tampered payloads", () => {
    const token = signUnsubscribeToken("user-123");
    const [body, sig] = token.split(".");
    const tamperedBody = Buffer.from(JSON.stringify({ userId: "hacker", issuedAt: 1 }))
      .toString("base64")
      .replace(/=+$/, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
    const verified = verifyUnsubscribeToken(`${tamperedBody}.${sig}`);
    expect(body).toBeTruthy();
    expect(verified).toBeNull();
  });

  it("rejects a wrong signature", () => {
    const token = signUnsubscribeToken("user-123");
    const [body] = token.split(".");
    const verified = verifyUnsubscribeToken(`${body}.AAAA`);
    expect(verified).toBeNull();
  });

  it("rejects a malformed token", () => {
    expect(verifyUnsubscribeToken("")).toBeNull();
    expect(verifyUnsubscribeToken("not-a-token")).toBeNull();
    expect(verifyUnsubscribeToken("a.b.c")).toBeNull();
  });

  it("rejects tokens signed with a different secret", () => {
    const token = signUnsubscribeToken("user-123");
    const originalSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = "a-different-secret-at-least-sixteen-chars-long";
    const verified = verifyUnsubscribeToken(token);
    process.env.JWT_SECRET = originalSecret;
    expect(verified).toBeNull();
  });

  it("builds a URL containing a valid token", () => {
    const url = buildUnsubscribeUrl("user-xyz", "https://signal.so");
    expect(url.startsWith("https://signal.so/unsubscribe?token=")).toBe(true);
    const token = decodeURIComponent(url.split("token=")[1]!);
    const verified = verifyUnsubscribeToken(token);
    expect(verified?.userId).toBe("user-xyz");
  });
});
