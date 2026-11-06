# AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-29.
# Scope: Runtime image for the PostgreSQL-backed user service. Author review: Done.
# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY drizzle.config.ts ./
COPY src ./src
# Claude Code (Opus 5.5), 2026-11-04: shared code (the logger) from the `shared` build
# context, which compose.yaml and cloudbuild.yaml pass in. Author review: Pending.
COPY --from=shared . ./src/shared/

ENV PORT=3333
EXPOSE 3333

CMD ["npm", "start"]