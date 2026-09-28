# AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-28.
# Scope: Add a development target for Drizzle tooling. Author review: pending.
FROM node:22-bookworm-slim AS tooling

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY drizzle.config.ts ./
COPY src ./src
CMD ["npm", "run", "db:check"]

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

CMD ["node", "dist/index.js"]
