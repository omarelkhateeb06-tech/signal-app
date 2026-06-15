import { Router } from "express";
import { getDashboard } from "../controllers/dashboardController";
import { requireAuth } from "../middleware/auth";
import { requireProfile } from "../middleware/requireProfile";

export const dashboardRouter: Router = Router();

dashboardRouter.use(requireAuth);

// Coverage/activity stats — a feed-surface discovery view, gated on onboarding
// like /feed and /search.
dashboardRouter.get("/", requireProfile, getDashboard);
