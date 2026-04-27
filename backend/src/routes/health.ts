import { Router, type Request, type Response } from "express";

// Commit SHA is passed in at build time (Dockerfile ARG GIT_COMMIT_SHA).
// Railway's Nixpacks-style builds auto-populate RAILWAY_GIT_COMMIT_SHA, so
// fall back to that when GIT_COMMIT_SHA isn't explicitly set.
const commit =
  process.env.GIT_COMMIT_SHA ?? process.env.RAILWAY_GIT_COMMIT_SHA ?? "unknown";
const builtAt = process.env.BUILD_TIME ?? "unknown";

export const healthRouter: Router = Router();

healthRouter.get("/", (_req: Request, res: Response): void => {
  res.json({
    data: {
      status: "ok",
      service: "signal-backend",
      commit,
      built_at: builtAt,
      env: process.env.NODE_ENV ?? "development",
      uptime_seconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    },
  });
});
