import { Router, type Request, type Response } from "express";

export const healthRouter: Router = Router();

healthRouter.get("/", (_req: Request, res: Response): void => {
  res.json({
    data: {
      status: "ok",
      service: "signal-backend",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    },
  });
});
