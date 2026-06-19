import { Router } from "express";
import {
  createBelief,
  deleteBelief,
  getBeliefEvolution,
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

// Belief Evolution (partial B): the full history of what's moved a belief.
beliefsRouter.get("/:id/evolution", getBeliefEvolution);

beliefsRouter.patch("/:id", updateBelief);
beliefsRouter.delete("/:id", deleteBelief);
