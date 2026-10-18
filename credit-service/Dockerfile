FROM node:22-alpine AS tooling
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
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
