import {
  INVITE_TOKEN_TTL_MS,
  signInviteToken,
  verifyInviteToken,
  buildInviteUrl,
  normalizeEmail,
} from "../src/services/teamInviteService";

describe("teamInviteService", () => {
  const teamId = "team-1";
  const email = "invitee@example.com";

  it("round-trips a signed token", () => {
    const { token } = signInviteToken({ teamId, email, role: "member" });
    const verified = verifyInviteToken(token);
    expect(verified).not.toBeNull();
    expect(verified?.teamId).toBe(teamId);
    expect(verified?.email).toBe(email);
    expect(verified?.role).toBe("member");
  });

  it("normalizes email casing in the payload", () => {
    const { token } = signInviteToken({
      teamId,
      email: "Mixed@Example.COM",
      role: "admin",
    });
    const verified = verifyInviteToken(token);
    expect(verified?.email).toBe("mixed@example.com");
  });

  it("returns expiresAt roughly 7 days out", () => {
    const now = Date.now();
    const { expiresAt } = signInviteToken({ teamId, email, role: "member", now });
    expect(expiresAt.getTime()).toBe(now + INVITE_TOKEN_TTL_MS);
  });

  it("rejects tokens with tampered body", () => {
    const { token } = signInviteToken({ teamId, email, role: "member" });
    const [body, sig] = token.split(".");
    const tampered = `${body}A.${sig}`;
    expect(verifyInviteToken(tampered)).toBeNull();
  });

  it("rejects tokens with tampered signature", () => {
    const { token } = signInviteToken({ teamId, email, role: "member" });
    const [body, sig] = token.split(".");
    const flipped = sig.slice(0, -2) + (sig.slice(-2) === "AA" ? "BB" : "AA");
    expect(verifyInviteToken(`${body}.${flipped}`)).toBeNull();
  });

  it("rejects expired tokens", () => {
    const now = Date.now();
    const { token } = signInviteToken({
      teamId,
      email,
      role: "member",
      now,
      ttlMs: 1_000,
    });
    expect(verifyInviteToken(token, now + 2_000)).toBeNull();
  });

  it("rejects malformed input", () => {
    expect(verifyInviteToken("")).toBeNull();
    expect(verifyInviteToken("nope")).toBeNull();
    expect(verifyInviteToken(null as unknown as string)).toBeNull();
    expect(verifyInviteToken(42 as unknown as string)).toBeNull();
  });

  it("produces unique tokens even for identical inputs", () => {
    const a = signInviteToken({ teamId, email, role: "member" });
    const b = signInviteToken({ teamId, email, role: "member" });
    expect(a.token).not.toBe(b.token);
  });

  it("builds a join URL with the token as a query parameter", () => {
    const url = buildInviteUrl("abc.def", "https://signal.so/");
    expect(url).toBe("https://signal.so/teams/join?token=abc.def");
  });

  it("normalizeEmail lowercases and trims", () => {
    expect(normalizeEmail("  Foo@Example.com ")).toBe("foo@example.com");
  });
});
