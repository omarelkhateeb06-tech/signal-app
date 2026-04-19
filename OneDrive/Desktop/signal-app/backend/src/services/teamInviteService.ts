import crypto from "node:crypto";

export const INVITE_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type InviteRole = "admin" | "member" | "viewer";

interface InviteTokenPayload {
  teamId: string;
  email: string;
  role: InviteRole;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
}

export interface VerifiedInviteToken {
  teamId: string;
  email: string;
  role: InviteRole;
  issuedAt: number;
  expiresAt: number;
}

function getSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret || secret.length < 16) {
    throw new Error("JWT_SECRET must be set and at least 16 characters");
  }
  return secret;
}

function base64UrlEncode(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf.toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function base64UrlDecode(input: string): Buffer {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const rem = padded.length % 4;
  const full = rem === 0 ? padded : padded + "=".repeat(4 - rem);
  return Buffer.from(full, "base64");
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export interface SignInviteInput {
  teamId: string;
  email: string;
  role: InviteRole;
  now?: number;
  ttlMs?: number;
}

export interface SignedInvite {
  token: string;
  expiresAt: Date;
}

export function signInviteToken(input: SignInviteInput): SignedInvite {
  const now = input.now ?? Date.now();
  const ttl = input.ttlMs ?? INVITE_TOKEN_TTL_MS;
  const payload: InviteTokenPayload = {
    teamId: input.teamId,
    email: normalizeEmail(input.email),
    role: input.role,
    issuedAt: now,
    expiresAt: now + ttl,
    nonce: crypto.randomBytes(16).toString("hex"),
  };
  const body = base64UrlEncode(JSON.stringify(payload));
  const mac = crypto.createHmac("sha256", getSecret()).update(body).digest();
  return {
    token: `${body}.${base64UrlEncode(mac)}`,
    expiresAt: new Date(payload.expiresAt),
  };
}

export function verifyInviteToken(token: unknown, now: number = Date.now()): VerifiedInviteToken | null {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!body || !sig) return null;

  let expected: Buffer;
  try {
    expected = crypto.createHmac("sha256", getSecret()).update(body).digest();
  } catch {
    return null;
  }
  let provided: Buffer;
  try {
    provided = base64UrlDecode(sig);
  } catch {
    return null;
  }
  if (provided.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(provided, expected)) return null;

  let parsed: InviteTokenPayload;
  try {
    parsed = JSON.parse(base64UrlDecode(body).toString("utf8")) as InviteTokenPayload;
  } catch {
    return null;
  }

  if (
    typeof parsed.teamId !== "string" ||
    typeof parsed.email !== "string" ||
    typeof parsed.role !== "string" ||
    typeof parsed.issuedAt !== "number" ||
    typeof parsed.expiresAt !== "number"
  ) {
    return null;
  }
  if (parsed.role !== "admin" && parsed.role !== "member" && parsed.role !== "viewer") {
    return null;
  }
  if (now >= parsed.expiresAt) return null;

  return {
    teamId: parsed.teamId,
    email: parsed.email,
    role: parsed.role,
    issuedAt: parsed.issuedAt,
    expiresAt: parsed.expiresAt,
  };
}

export function buildInviteUrl(token: string, frontendUrl: string): string {
  const base = frontendUrl.replace(/\/$/, "");
  return `${base}/teams/join?token=${encodeURIComponent(token)}`;
}

export { normalizeEmail };
