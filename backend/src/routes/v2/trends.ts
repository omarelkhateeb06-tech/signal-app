import { Router } from "express";
import { getSectorTrends } from "../../controllers/v2/trendsController";

export const trendsV2Router: Router = Router();

trendsV2Router.get("/:sector", getSectorTrends);
