import { Router } from "express";
import {
  createTeam,
  deleteTeam,
  getTeam,
  invite,
  join,
  listMembers,
  listTeams,
  removeMember,
  updateTeam,
} from "../controllers/teamController";
import { requireAuth } from "../middleware/auth";

export const teamsRouter: Router = Router();

teamsRouter.use(requireAuth);

teamsRouter.post("/", createTeam);
teamsRouter.get("/", listTeams);
teamsRouter.post("/join", join);

teamsRouter.get("/:team_id", getTeam);
teamsRouter.patch("/:team_id", updateTeam);
teamsRouter.delete("/:team_id", deleteTeam);

teamsRouter.get("/:team_id/members", listMembers);
teamsRouter.delete("/:team_id/members/:user_id", removeMember);

teamsRouter.post("/:team_id/invites", invite);
