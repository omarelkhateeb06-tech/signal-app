import { createHmac, randomBytes, timingSafeEqual } from "crypto";

// SIGNAL key format: sgnl_live_<43 chars base64url> = 53 chars total.
// The `sgnl_` vendor prefix (rather than the Stripe-style one) keeps us
// out of third-party secret scanners' Stripe rules — which false-positive
// on Stripe-shaped strings in committed test fixtures. The prefix is
// env-overridable so staging can ship `sgnl_test_` and make leaked-into-
// git scrubbing easier.
const DEFAULT_PREFIX = "sgnl_live_";
const SECRET_BYTES = 32; // 256-bit entropy
const KEY_PREFIX_DISPLAY_LEN = 14; // "sgnl_live_ABCD" shown in list responses

export interface GeneratedApiKey {
  fullKey: string;
  keyPrefix: string;
  keyHash: string;
}

function getPrefix(): string {
  const override = process.env.API_KEY_PREFIX?.trim();
  return override && override.length > 0 ? override : DEFAULT_PREFIX;
}

function getHashSecret(): string {
  const secret = process.env.API_KEY_HASH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("API_KEY_HASH_SECRET must be set and at least 32 characters");
  }
  return secret;
}

export function hashApiKey(fullKey: string): string {
  return createHmac("sha256", getHashSecret()).update(fullKey).digest("hex");
}

export function generateApiKey(): GeneratedApiKey {
  const secret = randomBytes(SECRET_BYTES).toString("base64url");
  const fullKey = `${getPrefix()}${secret}`;
  const keyPrefix = fullKey.slice(0, KEY_PREFIX_DISPLAY_LEN);
  const keyHash = hashApiKey(fullKey);
  return { fullKey, keyPrefix, keyHash };
}

export function verifyApiKey(candidate: string, storedHash: string): boolean {
  const candidateHash = hashApiKey(candidate);
  const a = Buffer.from(candidateHash, "hex");
  const b = Buffer.from(storedHash, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
