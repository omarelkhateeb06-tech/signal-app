import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import {
  createCheckoutSession,
  createPortalSession,
} from "../controllers/billingController";

// Phase 12h — billing routes.
// NOTE: the webhook route is mounted in app.ts BEFORE express.json() so the
// raw Buffer is intact for Stripe signature verification. Only JWT-protected
// routes live here.
export const billingRouter = Router();

billingRouter.post("/checkout", requireAuth, createCheckoutSession);
billingRouter.post("/portal", requireAuth, createPortalSession);
