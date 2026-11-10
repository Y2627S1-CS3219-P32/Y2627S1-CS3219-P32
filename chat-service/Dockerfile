FROM node:22-bookworm-slim AS tooling

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json drizzle.config.ts ./
COPY src ./src
# Claude Code (Opus 5.5), 2026-11-10: shared code (logger, telemetry, Pub/Sub messaging) from
# the `shared` build context, which compose.yaml and cloudbuild.yaml pass in. Author review: Pending.
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

# Claude Code (Opus 5.5), 2026-11-10: OpenTelemetry loads first; it stays off unless
# OTEL_EXPORTER_OTLP_ENDPOINT is set. See shared/README.md. Author review: Pending.
CMD ["node", "--import", "./dist/src/shared/telemetry.mjs", "dist/src/index.js"]
