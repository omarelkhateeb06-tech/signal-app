import { Router } from "express";
import {
  createBelief,
  deleteBelief,
  getChallenges,
  listBeliefs,
  respondToChallenge,
  runChallenges,
  updateBelief,
} from "../controllers/beliefController";
import { requireAuth } from "../middleware/auth";

// Belief maintenance (the missionary pivot). All routes JWT-authed.
export const beliefsRouter: Router = Router();

beliefsRouter.use(requireAuth);

// ---- Belief CRUD ----
beliefsRouter.get("/", listBeliefs);
beliefsRouter.post("/", createBelief);

// ---- "Reconsider" ritual ---- (specific paths before the /:id params)
beliefsRouter.get("/challenges", getChallenges);
beliefsRouter.post("/challenges/run", runChallenges);
beliefsRouter.post("/challenges/:id/respond", respondToChallenge);

beliefsRouter.patch("/:id", updateBelief);
beliefsRouter.delete("/:id", deleteBelief);
