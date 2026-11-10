# Build from the repository root: docker build -f agent-service/orchestrator/Dockerfile .
FROM node:24-alpine AS tooling
WORKDIR /app
COPY package.json package-lock.json ./
COPY agent-service/tsconfig.base.json ./agent-service/tsconfig.base.json
COPY agent-service/package.json agent-service/tsconfig.json ./agent-service/
COPY agent-service/contracts ./agent-service/contracts
COPY agent-service/common ./agent-service/common
COPY agent-service/scripts ./agent-service/scripts
COPY agent-service/db ./agent-service/db
COPY agent-service/chat/package.json ./agent-service/chat/package.json
COPY agent-service/orchestrator/package.json ./agent-service/orchestrator/package.json
RUN npm ci --ignore-scripts
COPY agent-service/orchestrator/src ./agent-service/orchestrator/src
COPY agent-service/orchestrator/tsconfig.json ./agent-service/orchestrator/tsconfig.json
RUN npm run build --workspace @campus/agent-contracts && npm run build --workspace agent-orchestrator-service
FROM tooling AS production-dependencies
RUN npm prune --omit=dev --ignore-scripts
FROM node:24-alpine AS runtime
WORKDIR /app
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=tooling /app/agent-service/package.json ./agent-service/package.json
COPY --from=tooling /app/agent-service/dist ./agent-service/dist
COPY --from=tooling /app/agent-service/orchestrator/package.json ./agent-service/orchestrator/package.json
COPY --from=tooling /app/agent-service/orchestrator/dist ./agent-service/orchestrator/dist
USER node
CMD ["node", "agent-service/orchestrator/dist/main.js"]
