process.env.JWT_SECRET =
  process.env.JWT_SECRET ?? "test-jwt-secret-please-change-for-real-deployments";
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? "1h";
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://test:test@localhost:5432/test";
process.env.NODE_ENV = "test";
// Keep tests offline: no Redis, no SendGrid deliveries, no scheduler.
process.env.REDIS_URL = "";
process.env.SENDGRID_API_KEY = "";
// No OpenAI either: the embedding stage (12e.6a) is opt-in on a real client
// via getOpenAIClient(). Clearing the key keeps getOpenAIClient() → null so
// the stage is bypassed unless a test explicitly injects a computeEmbedding
// seam. Without this, a developer's real OPENAI_API_KEY in .env leaks into the
// suite and fires an unexpected embedding soft-fail (double captureFailure).
process.env.OPENAI_API_KEY = "";
process.env.DISABLE_EMAIL_SCHEDULER = "1";
process.env.API_KEY_HASH_SECRET =
  process.env.API_KEY_HASH_SECRET ?? "test-api-key-hmac-secret-at-least-32-chars";
