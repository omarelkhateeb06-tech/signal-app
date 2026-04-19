import { Router } from "express";
import {
  getMyProfile,
  updateMe,
  updateMyProfile,
} from "../controllers/userController";
import { requireAuth } from "../middleware/auth";

export const usersRouter: Router = Router();

usersRouter.use(requireAuth);

usersRouter.get("/me/profile", getMyProfile);
usersRouter.put("/me/profile", updateMyProfile);
usersRouter.put("/me", updateMe);
