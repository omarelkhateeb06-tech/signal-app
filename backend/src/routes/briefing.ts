import { Router } from "express";
import { getThroughLine } from "../controllers/briefingController";
import { requireAuth } from "../middleware/auth";

export const briefingRouter: Router = Router();

briefingRouter.use(requireAuth);

// GET /api/v1/briefing/through-line?storyIds=<comma-separated uuids>
// Pro / pro_trial only; free users receive a gate envelope.
briefingRouter.get("/through-line", getThroughLine);
