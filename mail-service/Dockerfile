# AI Assistance Disclosure: ChatGPT (GPT-6), 2026-11-04.
# Scope: Runtime image for the Pub/Sub-driven Mailjet email service. Author review: Pending.
FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY src ./src

ENV PORT=3335
EXPOSE 3335

CMD ["npm", "start"]
