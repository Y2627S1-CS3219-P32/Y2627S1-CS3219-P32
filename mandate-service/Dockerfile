# Build from the repository root: docker build -f mandate-service/Dockerfile .
# Claude Code (Opus 5.5), 2026-11-10: shared/src (logger, telemetry, Pub/Sub messaging) is
# copied into src/shared/, and telemetry loads before the service; it stays off unless
# OTEL_EXPORTER_OTLP_ENDPOINT is set. See shared/README.md. Author review: Pending.
FROM node:24-alpine AS tooling
WORKDIR /app
COPY package.json package-lock.json ./
COPY mandate-service/package.json ./mandate-service/package.json
RUN npm ci --ignore-scripts --workspace mandate-service --include-workspace-root --include=optional
COPY mandate-service/src ./mandate-service/src
COPY shared/src ./mandate-service/src/shared
COPY mandate-service/tsconfig.json ./mandate-service/tsconfig.json
COPY mandate-service/drizzle.config.ts ./mandate-service/drizzle.config.ts
COPY mandate-service/migrations ./mandate-service/migrations
RUN npm run build --workspace mandate-service
FROM tooling AS production-dependencies
# Packages npm cannot hoist to the root (some OpenTelemetry ones) stay in the workspace's
# node_modules; made here so the COPY below works whether or not there are any.
RUN npm prune --omit=dev --ignore-scripts && mkdir -p mandate-service/node_modules
FROM node:24-alpine AS runtime
WORKDIR /app
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=production-dependencies /app/mandate-service/node_modules ./mandate-service/node_modules
COPY --from=tooling /app/mandate-service/package.json ./mandate-service/package.json
COPY --from=tooling /app/mandate-service/dist ./mandate-service/dist
# The service name in logs and telemetry; the working directory has no package.json.
ENV OTEL_SERVICE_NAME=mandate-service
USER node
CMD ["node", "--import", "./mandate-service/dist/shared/telemetry.mjs", "mandate-service/dist/main.js"]
