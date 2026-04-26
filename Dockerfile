# ── Stage 1: Dependency installation ───────────────────────────────────────
# Isolated layer — npm cache and dev tooling never reach the final image.
FROM node:20-alpine AS deps

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# ── Stage 2: Runtime ────────────────────────────────────────────────────────
# Lean production image — no npm, no npx, no build cache.
FROM node:20-alpine AS runtime

RUN apk add --no-cache wget && \
    rm -rf /usr/local/lib/node_modules/npm \
           /usr/local/bin/npm \
           /usr/local/bin/npx

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY src/ ./src/
COPY package.json ./

EXPOSE 5003

USER node

CMD ["node", "src/index.js"]
