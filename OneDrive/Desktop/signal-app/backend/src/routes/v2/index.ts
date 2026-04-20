import { Router } from "express";
import { apiKeyAuth } from "../../middleware/apiKeyAuth";
import { apiKeyRateLimit } from "../../middleware/apiKeyRateLimit";
import { storiesV2Router } from "./stories";

export const v2Router: Router = Router();

// All v2 routes require API key auth followed by per-key rate limiting.
// Order matters: apiKeyAuth populates req.apiKey; apiKeyRateLimit reads it.
v2Router.use(apiKeyAuth, apiKeyRateLimit);

v2Router.use("/stories", storiesV2Router);
