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

export const storiesRouter: Router = Router();

storiesRouter.use(requireAuth);

storiesRouter.get("/feed", getFeed);
storiesRouter.get("/search", searchStories);
storiesRouter.get("/:id/related", getRelatedStories);
storiesRouter.post("/:id/save", saveStory);
storiesRouter.delete("/:id/save", unsaveStory);
storiesRouter.get("/:story_id/comments", listStoryComments);
storiesRouter.post("/:story_id/comments", createComment);
storiesRouter.get("/:id", getStoryById);
