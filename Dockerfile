FROM node:20-alpine

WORKDIR /app

# Install wget for healthcheck
RUN apk add --no-cache wget

COPY package*.json ./
RUN (npm ci --omit=dev || npm install --omit=dev) && \
  npm cache clean --force && \
  rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx


COPY src/ ./src/

EXPOSE 5003

USER node

CMD ["node", "src/index.js"]
