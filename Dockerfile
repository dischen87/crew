# Stage 1: Build web frontend
FROM oven/bun:1 AS web-builder
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/mobile/package.json apps/mobile/package.json
COPY packages/api/package.json packages/api/package.json
COPY packages/mobile-client/package.json packages/mobile-client/package.json
COPY packages/mobile-data/package.json packages/mobile-data/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/web/package.json packages/web/package.json
COPY services/api-gateway/package.json services/api-gateway/package.json
COPY services/event-service/package.json services/event-service/package.json
COPY services/user-service/package.json services/user-service/package.json
RUN bun install --frozen-lockfile --filter @crew/web
COPY packages/shared packages/shared
COPY packages/web packages/web
WORKDIR /app/packages/web
RUN bun run build

# Stage 2: Production runtime
FROM oven/bun:1
WORKDIR /app

# Install API and shared workspace dependencies
COPY package.json bun.lock ./
COPY apps/mobile/package.json apps/mobile/package.json
COPY packages/api/package.json packages/api/
COPY packages/mobile-client/package.json packages/mobile-client/
COPY packages/mobile-data/package.json packages/mobile-data/
COPY packages/shared/package.json packages/shared/
COPY packages/web/package.json packages/web/
COPY services/api-gateway/package.json services/api-gateway/
COPY services/event-service/package.json services/event-service/
COPY services/user-service/package.json services/user-service/
RUN bun install --production --frozen-lockfile --filter @crew/api

# Copy API and shared source
COPY packages/api/src/ packages/api/src/
COPY packages/shared/ packages/shared/

# Copy built web assets
COPY --from=web-builder /app/packages/web/dist /app/packages/web/dist

# Create uploads dir
RUN mkdir -p /app/packages/api/uploads

EXPOSE 3000

CMD ["bun", "run", "packages/api/src/index.ts"]
