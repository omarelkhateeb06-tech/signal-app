import { Router } from "express";
import {
  postOnboardingComplete,
  postOnboardingEvents,
} from "../controllers/onboardingController";
import { requireAuth } from "../middleware/auth";

// JWT-authenticated — never mix with /api/v2 (API-key, external).
// Intentionally NOT guarded by requireProfile: the whole point of
// these endpoints is to _produce_ the completed profile.
export const onboardingRouter: Router = Router();

onboardingRouter.use(requireAuth);

onboardingRouter.post("/events", postOnboardingEvents);
onboardingRouter.post("/complete", postOnboardingComplete);
