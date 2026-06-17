import { Router } from "express";
import { postProductEvent } from "../controllers/productEventsController";
import { optionalAuth } from "../middleware/optionalAuth";

// Phase 12w — product / funnel analytics sink. Optional-auth: authed beacons
// are attributed to the user, anonymous beacons (pre-signup funnel) still land.
// Mounted at /api/v1/events. See productEventsController for the contract.
export const eventsRouter: Router = Router();

eventsRouter.use(optionalAuth);

eventsRouter.post("/", postProductEvent);
