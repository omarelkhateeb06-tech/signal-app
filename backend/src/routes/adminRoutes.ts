import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { requireAdmin } from "../middleware/requireAdmin";
import { getIngestionStatus } from "../controllers/adminController";

// Phase 12e.8 — admin routes mounted at `/admin/*`. Off the public
// `/api/v*` surface deliberately so they don't appear in the
// public-API documentation. All endpoints require both an
// authenticated user (requireAuth) and membership in the
// ADMIN_USER_IDS allowlist (requireAdmin).
const router = Router();

router.use(requireAuth, requireAdmin);

router.get("/ingestion/status", getIngestionStatus);

export default router;
