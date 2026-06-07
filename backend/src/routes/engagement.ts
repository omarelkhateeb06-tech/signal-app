import { Router } from "express";
import { postEngagementEvents } from "../controllers/engagementController";
import { requireAuth } from "../middleware/auth";

// JWT-authenticated engagement telemetry (Phase 12o). Append-only; see
// engagementController for the batch contract. Mounted at /api/v1/engagement.
export const engagementRouter: Router = Router();

engagementRouter.use(requireAuth);

engagementRouter.post("/events", postEngagementEvents);
