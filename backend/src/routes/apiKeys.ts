import { Router } from "express";
import {
  createApiKey,
  listApiKeys,
  revokeApiKey,
} from "../controllers/apiKeyController";
import { requireAuth } from "../middleware/auth";

export const apiKeysRouter: Router = Router();

apiKeysRouter.use(requireAuth);

apiKeysRouter.post("/", createApiKey);
apiKeysRouter.get("/", listApiKeys);
apiKeysRouter.delete("/:id", revokeApiKey);
