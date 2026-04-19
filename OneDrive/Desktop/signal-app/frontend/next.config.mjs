/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
};

// Only wrap with Sentry when a DSN is configured — keeps local/dev builds
// dependency-free and makes the SDK a true no-op without credentials.
async function withOptionalSentry(config) {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return config;
  try {
    const { withSentryConfig } = await import("@sentry/nextjs");
    return withSentryConfig(config, {
      silent: true,
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      widenClientFileUpload: true,
      disableLogger: true,
    });
  } catch {
    return config;
  }
}

export default await withOptionalSentry(nextConfig);
