# ─────────────────────────────────────────────────────────────────────────────
# OneMEME Launchpad — Production Dockerfile
#
# Single container running the NestJS REST API under PM2.
# On-chain data is served by The Graph subgraph (SUBGRAPH_URL).
# Off-chain data (points, referrals, chat) is stored in PostgreSQL (DATABASE_URL).
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: deps ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# ── Stage 2: build ────────────────────────────────────────────────────────────
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

# PM2 ecosystem config
COPY ecosystem.config.js ./ecosystem.config.js
COPY package.json        ./package.json

EXPOSE 3001

CMD ["pm2-runtime", "ecosystem.config.js"]
