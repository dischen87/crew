#!/bin/bash
set -e

echo "========================================="
echo "  Crew Staging — Local Setup"
echo "========================================="

# Load env
export $(cat .env.staging | grep -v '^#' | xargs)

echo ""
echo "[1/4] Starting Docker containers (Postgres + Redis)..."
docker compose up -d

echo ""
echo "[2/4] Waiting for Postgres to be ready..."
until docker exec crew-postgres pg_isready -U crew -d crew_staging > /dev/null 2>&1; do
  sleep 1
done
echo "       Postgres is ready."

echo ""
echo "[3/4] Running database setup & seed..."
cd packages/api
bun install
bun run db:setup
bun run db:seed
cd ../..

echo ""
echo "[4/4] Installing dependencies..."
cd packages/web
bun install
cd ../..
bun install

echo ""
echo "========================================="
echo "  Setup complete! Start dev servers:"
echo ""
echo "  API:  cd packages/api && bun run dev"
echo "  Web:  cd packages/web && bun run dev"
echo "  Both: bun run dev"
echo ""
echo "  API:     http://localhost:3000"
echo "  Web:     http://localhost:5173"
echo "  Health:  http://localhost:3000/health"
echo "========================================="
