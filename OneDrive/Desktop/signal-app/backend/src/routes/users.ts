import { Router } from "express";
import {
  getMyProfile,
  updateMe,
  updateMyProfile,
} from "../controllers/userController";
import { listMySaves } from "../controllers/storyController";
import { requireAuth } from "../middleware/auth";

export const usersRouter: Router = Router();

usersRouter.use(requireAuth);

usersRouter.get("/me/profile", getMyProfile);
usersRouter.put("/me/profile", updateMyProfile);
usersRouter.get("/me/saves", listMySaves);
usersRouter.put("/me", updateMe);
