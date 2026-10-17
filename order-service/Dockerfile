# AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
# Scope: Order-service image with a tooling target for Drizzle migrations, mirroring supplier-service. Author review: Pending.
FROM node:22-bookworm-slim AS tooling

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY drizzle.config.ts ./
COPY src ./src
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

CMD ["node", "dist/index.js"]
