import postgres from "postgres";
import Redis from "ioredis";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is required");
}

export const sql = postgres(DATABASE_URL);

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
export const redis = new Redis(REDIS_URL);
