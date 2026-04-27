import * as Sentry from "@sentry/node";
import type { Express } from "express";

let initialized = false;

export function initSentry(): boolean {
  if (initialized) return true;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return false;

  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
    release: process.env.SENTRY_RELEASE,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
    beforeSend(event) {
      if (event.request?.headers) {
        const h = event.request.headers as Record<string, unknown>;
        delete h.authorization;
        delete h.cookie;
        delete h["x-api-key"];
      }
      return event;
    },
  });

  initialized = true;
  return true;
}

export function isSentryEnabled(): boolean {
  return initialized;
}

export function installSentryErrorHandler(app: Express): void {
  if (!initialized) return;
  Sentry.setupExpressErrorHandler(app);
}
