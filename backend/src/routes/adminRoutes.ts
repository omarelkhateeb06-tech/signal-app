import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { requireAdmin } from "../middleware/requireAdmin";
import { getIngestionStatus } from "../controllers/adminController";
import {
  getDataAssetReport,
  getEngagementReport,
  getGrowthReport,
  getRevenueReport,
} from "../controllers/adminReportingController";

// Phase 12e.8 — admin routes mounted at `/admin/*`. Off the public
// `/api/v*` surface deliberately so they don't appear in the
// public-API documentation. All endpoints require both an
// authenticated user (requireAuth) and membership in the
// ADMIN_USER_IDS allowlist (requireAdmin).
const router = Router();

router.use(requireAuth, requireAdmin);

router.get("/ingestion/status", getIngestionStatus);

// Phase 12w — data-capture reporting (the spec's audit numbers).
router.get("/reports/growth", getGrowthReport);
router.get("/reports/revenue", getRevenueReport);
router.get("/reports/data-asset", getDataAssetReport);
router.get("/reports/engagement", getEngagementReport);

export default router;
