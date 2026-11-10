# AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-18.
# Scope: Saga orchestrator image with a tooling target for Drizzle migrations, mirroring order-service. Author review: Pending.
# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS tooling

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --include=optional --jobs=1

COPY tsconfig.json tsconfig.build.json ./
COPY drizzle.config.ts ./
COPY src ./src
# Claude Code (Opus 5.5), 2026-11-04: shared code (the logger) from the `shared` build
# context, which compose.yaml and cloudbuild.yaml pass in. Author review: Pending.
COPY --from=shared . ./src/shared/
COPY drizzle ./drizzle
CMD ["npm", "run", "db:migrate"]

FROM tooling AS build
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist

USER node
EXPOSE 3000

# Claude Code (Opus 5.5), 2026-11-04: OpenTelemetry loads first; it stays off unless
# OTEL_EXPORTER_OTLP_ENDPOINT is set. See shared/README.md. Author review: Pending.
CMD ["node", "--import", "./dist/shared/telemetry.mjs", "dist/index.js"]
