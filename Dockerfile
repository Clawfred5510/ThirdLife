FROM node:20-slim AS builder

WORKDIR /app

# Install deps needed to build better-sqlite3 native bindings
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy manifests first for cacheable install
COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/server/package.json ./packages/server/
COPY packages/client/package.json ./packages/client/

RUN npm ci --ignore-scripts --workspaces --include-workspace-root

# Copy source
COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY packages/server ./packages/server

# Rebuild native modules for the target platform
RUN npm rebuild better-sqlite3 --workspace=packages/server

# Build shared, then server
RUN npm run build:shared
RUN npm run build:server

# ── Runtime image ──────────────────────────────────────────────────────────
FROM node:20-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

# Runtime deps only
RUN apt-get update && apt-get install -y --no-install-recommends \
    tini \
    && rm -rf /var/lib/apt/lists/*

# Copy workspace manifests + installed modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules

# Copy built shared + server
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist

COPY --from=builder /app/packages/server/package.json ./packages/server/
COPY --from=builder /app/packages/server/dist ./packages/server/dist

# Railway mounts persistent volume here by convention
RUN mkdir -p /data

EXPOSE 2567
ENV PORT=2567
ENV HOST=0.0.0.0
ENV DATABASE_PATH=/data/thirdlife.db

ENTRYPOINT ["tini", "--"]
CMD ["node", "packages/server/dist/index.js"]
