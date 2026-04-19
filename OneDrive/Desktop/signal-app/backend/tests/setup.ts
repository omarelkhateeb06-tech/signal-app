process.env.JWT_SECRET =
  process.env.JWT_SECRET ?? "test-jwt-secret-please-change-for-real-deployments";
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? "1h";
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://test:test@localhost:5432/test";
process.env.NODE_ENV = "test";
