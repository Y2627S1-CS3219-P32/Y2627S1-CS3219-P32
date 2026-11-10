# Build from the repository root: docker build -f mandate-service/Dockerfile .
FROM node:24-alpine AS tooling
WORKDIR /app
COPY package.json package-lock.json ./
COPY mandate-service/package.json ./mandate-service/package.json
RUN npm ci --ignore-scripts --workspace mandate-service --include-workspace-root
COPY mandate-service/src ./mandate-service/src
COPY mandate-service/tsconfig.json ./mandate-service/tsconfig.json
COPY mandate-service/drizzle.config.ts ./mandate-service/drizzle.config.ts
COPY mandate-service/migrations ./mandate-service/migrations
RUN npm run build --workspace mandate-service
FROM tooling AS production-dependencies
RUN npm prune --omit=dev --ignore-scripts
FROM node:24-alpine AS runtime
WORKDIR /app
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=tooling /app/mandate-service/package.json ./mandate-service/package.json
COPY --from=tooling /app/mandate-service/dist ./mandate-service/dist
USER node
CMD ["node", "mandate-service/dist/main.js"]
