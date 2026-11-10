# Build from the repository root: docker build -f agent-service/orchestrator/Dockerfile .
# Claude Code (Opus 5.5), 2026-11-10: shared/src (logger, telemetry, Pub/Sub messaging) is
# copied into agent-service/common/shared/, and telemetry loads before the service; it stays
# off unless OTEL_EXPORTER_OTLP_ENDPOINT is set. See shared/README.md. Author review: Pending.
FROM node:24-alpine AS tooling
WORKDIR /app
COPY package.json package-lock.json ./
COPY agent-service/tsconfig.base.json ./agent-service/tsconfig.base.json
COPY agent-service/package.json agent-service/tsconfig.json ./agent-service/
COPY agent-service/contracts ./agent-service/contracts
COPY agent-service/common ./agent-service/common
COPY shared/src ./agent-service/common/shared
COPY agent-service/scripts ./agent-service/scripts
COPY agent-service/db ./agent-service/db
COPY agent-service/chat/package.json ./agent-service/chat/package.json
COPY agent-service/orchestrator/package.json ./agent-service/orchestrator/package.json
RUN npm ci --ignore-scripts
COPY agent-service/orchestrator/src ./agent-service/orchestrator/src
COPY agent-service/orchestrator/tsconfig.json ./agent-service/orchestrator/tsconfig.json
RUN npm run build --workspace @campus/agent-contracts && npm run build --workspace agent-orchestrator-service
FROM tooling AS production-dependencies
# Packages npm cannot hoist to the root (some OpenTelemetry ones) stay in the workspaces'
# node_modules; made here so the COPYs below work whether or not there are any.
RUN npm prune --omit=dev --ignore-scripts && mkdir -p agent-service/node_modules agent-service/orchestrator/node_modules
FROM node:24-alpine AS runtime
WORKDIR /app
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=production-dependencies /app/agent-service/node_modules ./agent-service/node_modules
COPY --from=production-dependencies /app/agent-service/orchestrator/node_modules ./agent-service/orchestrator/node_modules
COPY --from=tooling /app/agent-service/package.json ./agent-service/package.json
COPY --from=tooling /app/agent-service/dist ./agent-service/dist
COPY --from=tooling /app/agent-service/orchestrator/package.json ./agent-service/orchestrator/package.json
COPY --from=tooling /app/agent-service/orchestrator/dist ./agent-service/orchestrator/dist
# The service name in logs and telemetry; the working directory has no package.json.
ENV OTEL_SERVICE_NAME=agent-orchestrator-service
USER node
CMD ["node", "--import", "./agent-service/dist/common/shared/telemetry.mjs", "agent-service/orchestrator/dist/main.js"]
