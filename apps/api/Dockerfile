FROM oven/bun:1-alpine AS base
WORKDIR /app

FROM base AS install
COPY package.json bun.lockb* ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/
RUN bun install --frozen-lockfile

FROM base AS build
COPY --from=install /app/node_modules ./node_modules
COPY . .
RUN bun run --filter api build

FROM base AS release
COPY --from=build /app/apps/api/dist ./dist
COPY --from=install /app/node_modules ./node_modules
ENV NODE_ENV=production
EXPOSE 3001
CMD ["bun", "dist/index.js"]
