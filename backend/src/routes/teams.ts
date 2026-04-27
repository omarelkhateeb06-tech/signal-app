import { Router } from "express";
import {
  createTeam,
  createTeamStoryComment,
  deleteTeam,
  getTeam,
  getTeamDashboard,
  getTeamFeed,
  invite,
  inviteAccept,
  inviteMetadata,
  join,
  listInvites,
  listMembers,
  listTeams,
  listTeamStoryComments,
  removeMember,
  resendInvite,
  revokeInvite,
  updateTeam,
  updateTeamSettings,
} from "../controllers/teamController";
import { requireAuth } from "../middleware/auth";

export const teamsRouter: Router = Router();

// Unauth invite endpoints must be registered BEFORE the requireAuth middleware
// so they can be hit with or without a JWT. Both use two-segment paths that do
// not collide with `/:team_id` (single segment) or `/:team_id/:literal` routes.
teamsRouter.get("/invite/metadata", inviteMetadata);
teamsRouter.post("/invite/accept", inviteAccept);

teamsRouter.use(requireAuth);

teamsRouter.post("/", createTeam);
teamsRouter.get("/", listTeams);
teamsRouter.post("/join", join);

teamsRouter.get("/:team_id", getTeam);
teamsRouter.patch("/:team_id", updateTeam);
teamsRouter.delete("/:team_id", deleteTeam);

teamsRouter.get("/:team_id/members", listMembers);
teamsRouter.delete("/:team_id/members/:user_id", removeMember);

teamsRouter.get("/:team_id/invites", listInvites);
teamsRouter.post("/:team_id/invites", invite);
teamsRouter.post("/:team_id/invites/:invite_id/resend", resendInvite);
teamsRouter.delete("/:team_id/invites/:invite_id", revokeInvite);

teamsRouter.get("/:team_id/feed", getTeamFeed);
teamsRouter.get("/:team_id/dashboard", getTeamDashboard);
teamsRouter.patch("/:team_id/settings", updateTeamSettings);
teamsRouter.get(
  "/:team_id/stories/:story_id/comments",
  listTeamStoryComments,
);
teamsRouter.post(
  "/:team_id/stories/:story_id/comments",
  createTeamStoryComment,
);
