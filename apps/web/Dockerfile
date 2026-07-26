FROM oven/bun:1.3.9-alpine@sha256:9028ee7a60a04777190f0c3129ce49c73384d3fc918f3e5c75f5af188e431981 AS build

WORKDIR /app
COPY package.json bun.lock ./
COPY apps/mobile/package.json apps/mobile/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/mobile-client/package.json packages/mobile-client/package.json
COPY packages/mobile-data/package.json packages/mobile-data/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY services/api-gateway/package.json services/api-gateway/package.json
COPY services/user-service/package.json services/user-service/package.json
COPY services/event-service/package.json services/event-service/package.json
RUN bun install --frozen-lockfile --filter @crew/web

COPY apps/web apps/web
COPY apps/mobile/assets/fonts apps/mobile/assets/fonts
COPY apps/mobile/src/assets apps/mobile/src/assets
COPY apps/mobile/evidence/event-hub-option-2/reference-390x844.png apps/mobile/evidence/event-hub-option-2/reference-390x844.png
WORKDIR /app/apps/web
RUN bun run build

FROM caddy:2.11.4-alpine@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648

COPY --from=build /app/apps/web/dist /usr/share/caddy
