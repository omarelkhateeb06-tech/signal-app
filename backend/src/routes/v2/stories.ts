import { Router } from "express";
import { listStoriesV2 } from "../../controllers/v2/storiesController";

export const storiesV2Router: Router = Router();

storiesV2Router.get("/", listStoriesV2);
