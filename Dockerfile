FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN DATABASE_URL=file:/tmp/build.db npx prisma generate
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build

FROM node:24-bookworm-slim AS production
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./prisma.config.ts
RUN npm ci --omit=dev && DATABASE_URL=file:/tmp/build.db npx prisma generate && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/scripts/prepare-database.mjs ./scripts/prepare-database.mjs
COPY docker-entrypoint.sh ./
RUN mkdir -p /data && chown -R node:node /app /data && chmod +x /app/docker-entrypoint.sh
USER node
VOLUME ["/data"]
ENTRYPOINT ["/app/docker-entrypoint.sh"]
