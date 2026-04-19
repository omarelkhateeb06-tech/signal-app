import * as Sentry from "@sentry/node";
import { isSentryEnabled } from "./sentry";

export interface RequiredEnvVar {
  name: string;
  description: string;
}

// Vars whose absence in production silently degrades a user-visible feature.
// Do NOT list hard-fail vars like DATABASE_URL here — those already crash at
// boot. This list is specifically the "everything looks fine but nothing
// works" footguns that a quiet INFO log is not enough to surface.
export const PROD_REQUIRED_ENV_VARS: RequiredEnvVar[] = [
  {
    name: "SENDGRID_API_KEY",
    description:
      "email delivery (welcome, invite, digest) — emails will be console-logged and not sent",
  },
  {
    name: "JWT_SECRET",
    description:
      "auth tokens — using the insecure default secret puts every session at risk",
  },
  {
    name: "FRONTEND_URL",
    description:
      "invite and unsubscribe links — links in outbound emails will point at localhost",
  },
];

function envIsPresent(env: NodeJS.ProcessEnv, name: string): boolean {
  const value = env[name]?.trim();
  return Boolean(value && value.length > 0);
}

export interface EnvCheckResult {
  missing: RequiredEnvVar[];
  ranInProduction: boolean;
}

export function checkRequiredEnv(
  vars: RequiredEnvVar[] = PROD_REQUIRED_ENV_VARS,
  env: NodeJS.ProcessEnv = process.env,
): EnvCheckResult {
  const ranInProduction = env.NODE_ENV === "production";
  if (!ranInProduction) return { missing: [], ranInProduction };
  const missing = vars.filter((v) => !envIsPresent(env, v.name));
  return { missing, ranInProduction };
}

export function reportMissingEnv(result: EnvCheckResult): void {
  if (!result.ranInProduction || result.missing.length === 0) return;

  const names = result.missing.map((v) => v.name).join(", ");
  const header = `[signal-backend] WARN: missing required env var(s) in production: ${names}`;
  // eslint-disable-next-line no-console
  console.warn("=".repeat(Math.min(header.length, 80)));
  // eslint-disable-next-line no-console
  console.warn(header);
  for (const v of result.missing) {
    // eslint-disable-next-line no-console
    console.warn(`[signal-backend] WARN:   ${v.name} — ${v.description}`);
  }
  // eslint-disable-next-line no-console
  console.warn(
    "[signal-backend] WARN: set these in your host's environment (e.g. Railway Variables) and redeploy.",
  );
  // eslint-disable-next-line no-console
  console.warn("=".repeat(Math.min(header.length, 80)));

  if (isSentryEnabled()) {
    Sentry.captureMessage(
      `Startup: missing required env vars in production: ${names}`,
      { level: "warning" },
    );
  }
}

export function runStartupEnvCheck(): EnvCheckResult {
  const result = checkRequiredEnv();
  reportMissingEnv(result);
  return result;
}
