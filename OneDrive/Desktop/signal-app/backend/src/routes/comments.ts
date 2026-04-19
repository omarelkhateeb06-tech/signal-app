import { Router } from "express";
import {
  deleteComment,
  listReplies,
  updateComment,
} from "../controllers/commentController";
import { requireAuth } from "../middleware/auth";

export const commentsRouter: Router = Router();

commentsRouter.use(requireAuth);

commentsRouter.get("/:id/replies", listReplies);
commentsRouter.delete("/:id", deleteComment);
commentsRouter.patch("/:id", updateComment);
