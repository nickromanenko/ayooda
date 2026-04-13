# ─── Stage 1: install deps + build shared package ───────────────────────────
FROM oven/bun:1.3-slim AS builder

WORKDIR /app

# Copy workspace manifests so bun resolves workspace:* deps via the
# "workspaces" field in the root package.json
COPY package.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/

RUN bun install --frozen-lockfile

# Copy source
COPY tsconfig.base.json ./
COPY packages/shared/ ./packages/shared/
COPY apps/api/ ./apps/api/

# Build shared package so its dist/ is available for runtime imports
RUN cd packages/shared && bunx tsc

# ─── Stage 2: lean runtime image ─────────────────────────────────────────────
FROM oven/bun:1.3-slim

WORKDIR /app

# Shared package (compiled dist + package.json for module resolution)
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/shared/package.json ./packages/shared/package.json

# API source + dependencies
COPY --from=builder /app/apps/api/src ./apps/api/src
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder /app/apps/api/tsconfig.json ./apps/api/tsconfig.json
COPY --from=builder /app/tsconfig.base.json ./

# node_modules — root hoisted + per-package
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/node_modules ./apps/api/node_modules

WORKDIR /app/apps/api

ENV NODE_ENV=production
# Cloud Run injects PORT (defaults to 8080)
EXPOSE 8080

CMD ["bun", "run", "src/index.ts"]
