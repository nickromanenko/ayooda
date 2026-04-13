# Scraper — Cloud Run Job
# Uses Node.js + system Chromium (avoids bundling Chromium via Puppeteer download).

FROM node:20-slim

# Install Chromium and required system libs
RUN apt-get update && apt-get install -y \
  chromium \
  fonts-freefont-ttf \
  fonts-ipafont-gothic \
  fonts-wqy-zenhei \
  libgbm1 \
  --no-install-recommends \
  && rm -rf /var/lib/apt/lists/*

# Tell Puppeteer to use the system Chromium instead of downloading its own
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

RUN npm install -g pnpm@9

WORKDIR /app

# Copy workspace manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/scraper/package.json ./apps/scraper/
COPY packages/shared/package.json ./packages/shared/

# Install production + dev deps (dev needed for tsc)
RUN pnpm install --frozen-lockfile

# Copy source
COPY tsconfig.base.json ./
COPY packages/shared/ ./packages/shared/
COPY apps/scraper/ ./apps/scraper/

# Build shared + scraper (tsc → dist/)
RUN pnpm --filter shared build
RUN pnpm --filter scraper build

WORKDIR /app/apps/scraper

ENV NODE_ENV=production

# Cloud Run Jobs: container exits when job is done (exit 0 = success)
CMD ["node", "dist/index.js"]
