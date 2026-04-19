# Multi-stage build for SIGNAL backend
# Compiles TypeScript (tsc -> dist/) and runs the compiled server in production

# ============================================
# Stage 1: Builder — installs all deps and compiles TS
# ============================================
FROM node:20-alpine AS builder

WORKDIR /app

# Copy workspace manifests
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/

# Install all deps (including dev) so tsc is available
RUN npm ci --workspace=backend --include-workspace-root

# Copy backend source
COPY backend/ ./backend/

# Compile TypeScript to dist/
WORKDIR /app/backend
RUN npm run build

# ============================================
# Stage 2: Runner — lean production image
# ============================================
FROM node:20-alpine AS runner

# Non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S signal -u 1001

WORKDIR /app

# Copy manifests
COPY --from=builder --chown=signal:nodejs /app/package.json /app/package-lock.json ./
COPY --from=builder --chown=signal:nodejs /app/backend/package.json ./backend/

# Install production deps only
RUN npm ci --workspace=backend --include-workspace-root --omit=dev && \
    npm cache clean --force

# Copy compiled code
COPY --from=builder --chown=signal:nodejs /app/backend/dist ./backend/dist

# Copy drizzle config (needed for migrations)
COPY --from=builder --chown=signal:nodejs /app/backend/drizzle.config.ts ./backend/drizzle.config.ts

USER signal

WORKDIR /app/backend

EXPOSE 3001

# Healthcheck
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3001/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "dist/server.js"]
