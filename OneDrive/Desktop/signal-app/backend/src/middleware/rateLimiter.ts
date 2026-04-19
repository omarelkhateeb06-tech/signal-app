import rateLimit, { type Options, type RateLimitRequestHandler } from "express-rate-limit";

const DISABLED = process.env.NODE_ENV === "test" || process.env.DISABLE_RATE_LIMIT === "1";

function build(options: Partial<Options>): RateLimitRequestHandler {
  return rateLimit({
    standardHeaders: "draft-7",
    legacyHeaders: false,
    skip: () => DISABLED,
    message: {
      error: { code: "RATE_LIMITED", message: "Too many requests, please try again later." },
    },
    ...options,
  });
}

export const apiLimiter = build({
  windowMs: 60_000,
  limit: Number(process.env.RATE_LIMIT_API ?? 300),
});

export const authLimiter = build({
  windowMs: 15 * 60_000,
  limit: Number(process.env.RATE_LIMIT_AUTH ?? 20),
});

export const emailLimiter = build({
  windowMs: 60_000,
  limit: Number(process.env.RATE_LIMIT_EMAIL ?? 30),
});
