FROM oven/bun:1.3.9-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/mobile/package.json apps/mobile/package.json
COPY packages/api/package.json packages/api/package.json
COPY packages/mobile-client/package.json packages/mobile-client/package.json
COPY packages/mobile-data/package.json packages/mobile-data/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/web/package.json packages/web/package.json
COPY services/api-gateway/package.json services/api-gateway/package.json
COPY services/user-service/package.json services/user-service/package.json
COPY services/event-service/package.json services/event-service/package.json
RUN bun install --production --frozen-lockfile --filter @crew/event-service

FROM oven/bun:1.3.9-alpine
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY packages/shared ./packages/shared
COPY services/event-service ./services/event-service
USER bun
EXPOSE 3002
CMD ["bun", "services/event-service/src/index.ts"]
