import IORedis, { type Redis } from "ioredis";

let cached: Redis | null = null;
let warnedMissing = false;

export function getRedisUrl(): string | null {
  const url = process.env.REDIS_URL?.trim();
  return url && url.length > 0 ? url : null;
}

export function isRedisConfigured(): boolean {
  return getRedisUrl() !== null;
}

export function getRedis(): Redis | null {
  if (cached) return cached;
  const url = getRedisUrl();
  if (!url) {
    if (!warnedMissing) {
      // eslint-disable-next-line no-console
      console.warn("[signal-backend] REDIS_URL not set — email queue running in no-op mode");
      warnedMissing = true;
    }
    return null;
  }
  cached = new IORedis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false,
  });
  cached.on("error", (err) => {
    // eslint-disable-next-line no-console
    console.error("[signal-backend] redis error:", err.message);
  });
  return cached;
}

export async function closeRedis(): Promise<void> {
  if (cached) {
    await cached.quit().catch(() => undefined);
    cached = null;
  }
}
