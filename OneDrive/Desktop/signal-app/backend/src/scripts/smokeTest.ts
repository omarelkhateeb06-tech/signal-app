/**
 * Post-deployment smoke tests.
 *
 * Usage:
 *   SMOKE_BASE_URL=https://signal-app-production-cd33.up.railway.app \
 *     npm run smoke --workspace=backend
 *
 * Optional:
 *   SMOKE_EMAIL=smoke+<stamp>@example.com
 *   SMOKE_PASSWORD=<random>
 *   SMOKE_SKIP_SIGNUP=1           # only hit public endpoints
 *   SMOKE_ORIGIN=<frontend-origin> # for the CORS preflight check
 *
 * Exits non-zero on any failure so CI / deploy hooks can gate on it.
 */

import "dotenv/config";

const baseUrl = (process.env.SMOKE_BASE_URL ?? "http://localhost:3001").replace(/\/$/, "");
const skipSignup = process.env.SMOKE_SKIP_SIGNUP === "1";
const suffix = Date.now();
const email = process.env.SMOKE_EMAIL ?? `smoke+${suffix}@signal.test`;
const password =
  process.env.SMOKE_PASSWORD ?? `Smoke-${suffix}-${Math.random().toString(36).slice(2, 10)}`;

interface Check {
  name: string;
  run: () => Promise<void>;
}

function log(step: string, detail?: string): void {
  // eslint-disable-next-line no-console
  console.log(`[smoke] ${step}${detail ? `: ${detail}` : ""}`);
}

async function expectOk(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${baseUrl}${path}`, init);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${path} returned ${res.status}: ${body.slice(0, 200)}`);
  }
  return res;
}

const checks: Check[] = [
  {
    name: "health",
    run: async () => {
      const res = await expectOk("/health");
      const body = (await res.json()) as { data?: { status?: string } };
      if (body.data?.status !== "ok") {
        throw new Error(`unexpected body: ${JSON.stringify(body)}`);
      }
    },
  },
  {
    name: "cors-preflight",
    run: async () => {
      const res = await fetch(`${baseUrl}/api/v1/stories/feed`, {
        method: "OPTIONS",
        headers: {
          Origin: process.env.SMOKE_ORIGIN ?? "http://localhost:3000",
          "Access-Control-Request-Method": "GET",
        },
      });
      if (res.status >= 400) throw new Error(`OPTIONS returned ${res.status}`);
    },
  },
];

if (!skipSignup) {
  let token: string | null = null;

  checks.push({
    name: "signup",
    run: async () => {
      const res = await fetch(`${baseUrl}/api/v1/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name: "Smoke Tester" }),
      });
      if (!res.ok && res.status !== 409) {
        throw new Error(`signup failed with ${res.status}`);
      }
      if (res.ok) {
        const body = (await res.json()) as { data?: { token?: string } };
        token = body.data?.token ?? null;
      }
    },
  });

  checks.push({
    name: "login",
    run: async () => {
      const res = await expectOk("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = (await res.json()) as { data?: { token?: string } };
      token = body.data?.token ?? null;
      if (!token) throw new Error("login succeeded but no token returned");
    },
  });

  checks.push({
    name: "feed",
    run: async () => {
      if (!token) throw new Error("no token (login did not run)");
      await expectOk("/api/v1/stories/feed?limit=5", {
        headers: { Authorization: `Bearer ${token}` },
      });
    },
  });

  checks.push({
    name: "me",
    run: async () => {
      if (!token) throw new Error("no token");
      await expectOk("/api/v1/auth/me", {
        headers: { Authorization: `Bearer ${token}` },
      });
    },
  });
}

async function main(): Promise<void> {
  log("start", `base=${baseUrl}`);
  let failed = 0;
  for (const check of checks) {
    const start = Date.now();
    try {
      await check.run();
      log(`  ok   ${check.name}`, `${Date.now() - start}ms`);
    } catch (err) {
      failed += 1;
      const message = err instanceof Error ? err.message : String(err);
      log(`  FAIL ${check.name}`, message);
    }
  }
  if (failed > 0) {
    log("result", `${failed} failure(s)`);
    process.exit(1);
  }
  log("result", `${checks.length} checks passed`);
}

void main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[smoke] unexpected error", err);
  process.exit(1);
});
