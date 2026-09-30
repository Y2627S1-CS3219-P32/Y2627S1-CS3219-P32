# AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-29.
# Scope: Runtime image for the PostgreSQL-backed user service. Author review: Done.
FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY drizzle.config.ts ./
COPY src ./src

ENV PORT=3333
EXPOSE 3333

CMD ["npm", "start"]