# ─────────────────────────────────────────────────────────────────────────────
# OneMEME Launchpad — Production Dockerfile
#
# Single container running both processes under PM2:
#   • Ponder indexer  (BSC → PostgreSQL)
#   • NestJS REST API (PostgreSQL → HTTP :3001)
#
# Named volume /app/.ponder persists Ponder's checkpoint + cache files so the
# indexer never re-syncs from scratch on container restart.
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: deps ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# ── Stage 2: build (NestJS only — Ponder runs from source via its own compiler) ──
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json* tsconfig*.json ./
RUN npm ci

COPY abis/        ./abis/
COPY src/         ./src/

# Compile the NestJS API to dist/api/
RUN npm run api:build

# ── Stage 3: production image ──────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

# PM2 process manager
RUN npm install -g pm2

# Copy production node_modules
COPY --from=deps    /app/node_modules ./node_modules

# Copy compiled API
COPY --from=builder /app/dist         ./dist

# Copy everything Ponder needs to run
COPY abis/            ./abis/
COPY src/index.ts     ./src/index.ts
COPY ponder.config.ts ./ponder.config.ts
COPY ponder.schema.ts ./ponder.schema.ts
COPY tsconfig.json    ./tsconfig.json
COPY package.json     ./package.json

# PM2 ecosystem config
COPY ecosystem.config.js ./ecosystem.config.js

# Ponder checkpoint + cache (mount as named volume in production)
VOLUME ["/app/.ponder"]

EXPOSE 3001

CMD ["pm2-runtime", "ecosystem.config.js"]
