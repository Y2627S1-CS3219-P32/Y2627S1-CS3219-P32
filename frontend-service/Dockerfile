# AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-28.
# Scope: Independent Nuxt production build and runtime. Author review: Done.
# Claude Code (Opus 5.5), 2026-11-04: OpenTelemetry for the Nitro server: its packages in a
# stage of their own and shared/src/telemetry.mts from the `shared` build context, loaded
# before the server. It stays off unless OTEL_EXPORTER_OTLP_ENDPOINT is set. Author review: Pending.
# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS telemetry
WORKDIR /otel
COPY telemetry/package.json telemetry/package-lock.json ./
RUN npm ci --omit=dev
# Node runs the .mts as is, stripping its types.
COPY --from=shared telemetry.mts ./

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production NITRO_HOST=0.0.0.0 NITRO_PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /app/.output ./.output
COPY --from=telemetry --chown=node:node /otel ./otel
USER node
EXPOSE 3000
CMD ["node", "--import", "./otel/telemetry.mts", ".output/server/index.mjs"]
