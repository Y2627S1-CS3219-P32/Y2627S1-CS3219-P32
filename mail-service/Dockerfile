# AI Assistance Disclosure: ChatGPT (GPT-6), 2026-11-04.
# Scope: Runtime image for the Pub/Sub-driven Mailjet email service. Author review: Pending.
FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY src ./src
# Claude Code (Opus 5.5), 2026-11-10: shared code (logger, telemetry, Pub/Sub messaging) from
# the `shared` build context, which compose.yaml and cloudbuild.yaml pass in. Author review: Pending.
COPY --from=shared . ./src/shared/

ENV PORT=3335
EXPOSE 3335

# Claude Code (Opus 5.5), 2026-11-10: `npm start` loads OpenTelemetry first (see package.json);
# it stays off unless OTEL_EXPORTER_OTLP_ENDPOINT is set. Author review: Pending.
CMD ["npm", "start"]
