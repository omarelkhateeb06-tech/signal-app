import express, { type Express } from "express";
import cors, { type CorsOptions } from "cors";
import helmet from "helmet";
import { errorHandler } from "./middleware/errorHandler";
import { notFoundHandler } from "./middleware/notFoundHandler";
import { apiLimiter, authLimiter, emailLimiter } from "./middleware/rateLimiter";
import { installSentryErrorHandler } from "./lib/sentry";
import { authRouter } from "./routes/auth";
import { healthRouter } from "./routes/health";
import { commentsRouter } from "./routes/comments";
import { emailsRouter } from "./routes/emails";
import { storiesRouter } from "./routes/stories";
import { teamsRouter } from "./routes/teams";
import { usersRouter } from "./routes/users";

function parseAllowedOrigins(): string[] {
  const raw =
    process.env.ALLOWED_ORIGINS ??
    process.env.FRONTEND_URL ??
    "http://localhost:3000";
  return raw
    .split(",")
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
}

function buildCorsOptions(): CorsOptions {
  const allowed = parseAllowedOrigins();
  const allowAll = allowed.includes("*");
  return {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (allowAll || allowed.includes(origin)) return cb(null, true);
      return cb(new Error(`Origin ${origin} not allowed by CORS`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  };
}

export function createApp(): Express {
  const app = express();

  app.set("trust proxy", process.env.TRUST_PROXY ?? 1);

  app.use(helmet());
  app.use(cors(buildCorsOptions()));
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true }));

  app.use("/health", healthRouter);

  app.use("/api", apiLimiter);
  app.use("/api/v1/auth", authLimiter, authRouter);
  app.use("/api/v1/users", usersRouter);
  app.use("/api/v1/stories", storiesRouter);
  app.use("/api/v1/comments", commentsRouter);
  app.use("/api/v1/teams", teamsRouter);
  app.use("/api/v1/emails", emailLimiter, emailsRouter);

  installSentryErrorHandler(app);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
