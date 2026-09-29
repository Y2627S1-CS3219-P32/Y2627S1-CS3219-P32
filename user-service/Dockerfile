# AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-29.
# Scope: Container image for the user service. Author review: Done.
FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY drizzle.config.ts ./
COPY src ./src
RUN npx drizzle-kit push

ENV PORT=3333
EXPOSE 3333

CMD ["npm", "start"]