import request from "supertest";
import { z } from "zod";
import { createApp } from "../src/app";

jest.mock("../src/db", () => ({
  __esModule: true,
  db: {},
  schema: {},
  pool: {},
}));

const healthSchema = z.object({
  data: z.object({
    status: z.literal("ok"),
    service: z.string(),
    commit: z.string(),
    built_at: z.string(),
    env: z.string(),
    uptime_seconds: z.number().int().nonnegative(),
    timestamp: z.string(),
  }),
});

describe("GET /health", () => {
  const app = createApp();

  it("returns 200 with the expected shape", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(() => healthSchema.parse(res.body)).not.toThrow();
  });

  it("returns 'unknown' for commit/built_at when env vars are unset", async () => {
    const prevCommit = process.env.GIT_COMMIT_SHA;
    const prevRailway = process.env.RAILWAY_GIT_COMMIT_SHA;
    const prevBuilt = process.env.BUILD_TIME;
    delete process.env.GIT_COMMIT_SHA;
    delete process.env.RAILWAY_GIT_COMMIT_SHA;
    delete process.env.BUILD_TIME;
    try {
      jest.resetModules();
      const { createApp: createAppFresh } = await import("../src/app");
      const freshApp = createAppFresh();
      const res = await request(freshApp).get("/health");
      expect(res.status).toBe(200);
      expect(res.body.data.commit).toBe("unknown");
      expect(res.body.data.built_at).toBe("unknown");
    } finally {
      if (prevCommit !== undefined) process.env.GIT_COMMIT_SHA = prevCommit;
      if (prevRailway !== undefined) process.env.RAILWAY_GIT_COMMIT_SHA = prevRailway;
      if (prevBuilt !== undefined) process.env.BUILD_TIME = prevBuilt;
    }
  });
});
