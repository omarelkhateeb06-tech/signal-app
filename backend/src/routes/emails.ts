import { Router } from "express";
import { unsubscribe, updateEmailPreferences } from "../controllers/emailController";
import { requireAuth } from "../middleware/auth";

export const emailsRouter: Router = Router();

// Public — callable from email link without auth.
emailsRouter.post("/unsubscribe", unsubscribe);
emailsRouter.get("/unsubscribe", unsubscribe);

// Authenticated preferences update.
emailsRouter.put("/preferences", requireAuth, updateEmailPreferences);
