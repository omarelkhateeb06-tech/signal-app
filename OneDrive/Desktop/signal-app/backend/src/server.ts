import "dotenv/config";
import { createApp } from "./app";
import { initSentry } from "./lib/sentry";
import { runStartupEnvCheck } from "./lib/envCheck";
import { startEmailWorker } from "./jobs/emailWorker";
import { startEmailScheduler } from "./jobs/emailScheduler";
import { startAggregationWorker } from "./jobs/aggregationWorker";
import { scheduleAggregationRepeatable } from "./jobs/aggregationQueue";

initSentry();
runStartupEnvCheck();

const port = Number(process.env.PORT ?? 3001);
const app = createApp();

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`[signal-backend] listening on http://localhost:${port}`);
});

startEmailWorker();
startEmailScheduler();
startAggregationWorker();
void scheduleAggregationRepeatable().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error("[signal-backend] failed to schedule aggregation cron:", err);
});

export { app };
