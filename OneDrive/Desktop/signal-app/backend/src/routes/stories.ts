import { Router } from "express";
import {
  getFeed,
  getRelatedStories,
  getStoryById,
  saveStory,
  searchStories,
  unsaveStory,
} from "../controllers/storyController";
import {
  createComment,
  listStoryComments,
} from "../controllers/commentController";
import { requireAuth } from "../middleware/auth";
import { requireProfile } from "../middleware/requireProfile";

export const storiesRouter: Router = Router();

storiesRouter.use(requireAuth);

// Feed-surface routes are gated by onboarding completion. Defense-
// in-depth: the frontend also enforces this via useRequireOnboarded,
// but we don't trust the client. See middleware/requireProfile.ts.
//
// Save/unsave and comments are deliberately NOT gated — the story
// detail page is served to half-onboarded users only via explicit
// direct link (rare), and gating those would surprise API consumers
// more than gating just the discovery surfaces.
storiesRouter.get("/feed", requireProfile, getFeed);
storiesRouter.get("/search", requireProfile, searchStories);
storiesRouter.get("/:id/related", getRelatedStories);
storiesRouter.post("/:id/save", saveStory);
storiesRouter.delete("/:id/save", unsaveStory);
storiesRouter.get("/:story_id/comments", listStoryComments);
storiesRouter.post("/:story_id/comments", createComment);
storiesRouter.get("/:id", getStoryById);
