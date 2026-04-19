import { Router } from "express";
import { login, logout, me, signup } from "../controllers/authController";
import { requireAuth } from "../middleware/auth";

export const authRouter: Router = Router();

authRouter.post("/signup", signup);
authRouter.post("/login", login);
authRouter.get("/me", requireAuth, me);
authRouter.post("/logout", logout);
