# ── Stage 1: Dependency installation ───────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# ── Stage 2: Runtime ────────────────────────────────────────────────────────
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

CMD ["node", "src/index.js"]
