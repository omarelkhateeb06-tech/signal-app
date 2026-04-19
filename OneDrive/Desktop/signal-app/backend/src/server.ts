import "dotenv/config";
import { createApp } from "./app";
import { initSentry } from "./lib/sentry";
import { startEmailWorker } from "./jobs/emailWorker";
import { startEmailScheduler } from "./jobs/emailScheduler";

initSentry();

const port = Number(process.env.PORT ?? 3001);
const app = createApp();

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`[signal-backend] listening on http://localhost:${port}`);
});

startEmailWorker();
startEmailScheduler();

export { app };
