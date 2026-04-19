import crypto from "node:crypto";

interface TokenPayload {
  userId: string;
  issuedAt: number;
}

function getSecret(): string {
  const secret = process.env.UNSUBSCRIBE_SECRET?.trim() || process.env.JWT_SECRET?.trim();
  if (!secret || secret.length < 16) {
    throw new Error("UNSUBSCRIBE_SECRET or JWT_SECRET must be set and at least 16 characters");
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

export function signUnsubscribeToken(userId: string, now: number = Date.now()): string {
  const payload: TokenPayload = { userId, issuedAt: now };
  const body = base64UrlEncode(JSON.stringify(payload));
  const mac = crypto.createHmac("sha256", getSecret()).update(body).digest();
  return `${body}.${base64UrlEncode(mac)}`;
}

export interface VerifiedToken {
  userId: string;
  issuedAt: number;
}

export function verifyUnsubscribeToken(token: string): VerifiedToken | null {
  if (typeof token !== "string") return null;
  const [body, sig] = token.split(".");
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

  try {
    const parsed = JSON.parse(base64UrlDecode(body).toString("utf8")) as TokenPayload;
    if (typeof parsed.userId !== "string" || typeof parsed.issuedAt !== "number") return null;
    return { userId: parsed.userId, issuedAt: parsed.issuedAt };
  } catch {
    return null;
  }
}

export function buildUnsubscribeUrl(userId: string, frontendUrl: string): string {
  const token = signUnsubscribeToken(userId);
  const base = frontendUrl.replace(/\/$/, "");
  return `${base}/unsubscribe?token=${encodeURIComponent(token)}`;
}
