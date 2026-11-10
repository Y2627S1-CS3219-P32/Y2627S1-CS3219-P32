# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS tooling
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json drizzle.config.ts ./
COPY src ./src
# Claude Code (Opus 5.5), 2026-11-04: shared code (the logger) from the `shared` build
# context, which compose.yaml and cloudbuild.yaml pass in. Author review: Pending.
COPY --from=shared . ./src/shared/
COPY migrations ./migrations
RUN npm run build
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=tooling /app/package*.json ./
RUN npm ci --omit=dev
COPY --from=tooling /app/dist ./dist
COPY --from=tooling /app/migrations ./migrations
EXPOSE 3000
CMD ["npm","start"]
