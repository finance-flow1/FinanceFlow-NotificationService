# ── Stage 1: Dependency installation ───────────────────────────────────────
# Isolated layer — npm cache and dev tooling never reach the final image.
FROM node:20-alpine AS deps

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# ── Stage 2: Runtime ────────────────────────────────────────────────────────
# Lean production image — runs as non-root node user (uid 1000).
FROM node:20-alpine AS runtime

# Install wget for health probes and strip npm/npx tooling
RUN apk add --no-cache wget && \
    rm -rf /usr/local/lib/node_modules/npm \
           /usr/local/bin/npm \
           /usr/local/bin/npx

WORKDIR /app

# Copy with explicit ownership so the node user can read all files
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node src/ ./src/
COPY --chown=node:node package.json ./

EXPOSE 5003

USER node

CMD ["node", "src/index.js"]
