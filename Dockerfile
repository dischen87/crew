# Stage 1: Build web frontend
FROM oven/bun:1 AS web-builder
WORKDIR /app/packages/web
COPY packages/web/package.json ./
RUN bun install
COPY packages/web/ ./
RUN bun run build

# Stage 2: Production runtime
FROM oven/bun:1
WORKDIR /app

# Install API dependencies
COPY packages/api/package.json packages/api/
WORKDIR /app/packages/api
RUN bun install --production

# Copy API source
COPY packages/api/src/ src/

# Copy built web assets
COPY --from=web-builder /app/packages/web/dist /app/packages/web/dist

# Create uploads dir
RUN mkdir -p /app/packages/api/uploads

EXPOSE 3000

CMD ["bun", "run", "src/index.ts"]
