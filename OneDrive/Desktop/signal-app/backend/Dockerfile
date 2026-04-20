# Dockerfile for SIGNAL backend
# Railway sends the backend/ folder as the build context (root dir = backend/)
# So all paths here are relative to backend/, NOT the monorepo root.

# ============================================
# Stage 1: Builder
# ============================================
FROM node:20-alpine AS builder

WORKDIR /app

# Copy backend manifest + lockfile
COPY package.json ./
# Note: no package-lock.json in backend/ (it's at the monorepo root)
# So we use npm install instead of npm ci here

# Install all deps (including dev for TypeScript compilation)
RUN npm install

# Copy source
COPY . .

# Compile TypeScript to dist/
RUN npm run build

# ============================================
# Stage 2: Runner (lean production image)
# ============================================
FROM node:20-alpine AS runner

# Non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S signal -u 1001

WORKDIR /app

# Build provenance — consumed by GET /health. Railway's Nixpacks auto-sets
# RAILWAY_GIT_COMMIT_SHA at runtime, so these ARGs are optional; pass them
# explicitly in non-Railway builds to get commit/built_at on /health.
ARG GIT_COMMIT_SHA=unknown
ARG BUILD_TIME=unknown
ENV GIT_COMMIT_SHA=$GIT_COMMIT_SHA
ENV BUILD_TIME=$BUILD_TIME

# Copy manifest
COPY --from=builder --chown=signal:nodejs /app/package.json ./

# Install production deps only
RUN npm install --omit=dev && \
    npm cache clean --force

# Copy compiled code + drizzle config (for migrations)
COPY --from=builder --chown=signal:nodejs /app/dist ./dist
COPY --from=builder --chown=signal:nodejs /app/drizzle.config.ts ./drizzle.config.ts

USER signal

EXPOSE 3001

# Healthcheck
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3001/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

# Run pending migrations before starting the server. If migrate exits non-zero,
# the container exits before binding the server port, so Railway's health check
# fails and the previous healthy container keeps serving traffic. To start
# without migrating (emergency rollback), override CMD to ["node", "dist/server.js"].
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/server.js"]
