// Reddit API adapter — stub. Implementation lands in 12e.5e (OAuth,
// fixed subreddit list, top-of-day above score threshold, 4-hour
// cadence).

import type { AdapterContext, AdapterResult } from "../types";

export async function redditAdapter(_ctx: AdapterContext): Promise<AdapterResult> {
  throw new Error("reddit_api adapter not yet implemented (Phase 12e.5e)");
}
