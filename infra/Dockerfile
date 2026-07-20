ARG BUN_IMAGE=oven/bun:1.3.9-alpine@sha256:9028ee7a60a04777190f0c3129ce49c73384d3fc918f3e5c75f5af188e431981
FROM ${BUN_IMAGE}

WORKDIR /app

COPY package.json bun.lock ./
COPY apps/mobile/package.json ./apps/mobile/package.json
COPY packages ./packages
COPY services ./services
COPY infra ./infra

RUN bun install --production --frozen-lockfile

ENV NODE_ENV=development
USER bun
