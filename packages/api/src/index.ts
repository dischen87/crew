import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { serveStatic } from "hono/bun";

import auth from "./routes/auth";
import groups from "./routes/groups";
import events from "./routes/events";
import golf from "./routes/golf";
import chat from "./routes/chat";
import media from "./routes/media";
import master from "./routes/master";
import flights from "./routes/flights";
import locations from "./routes/locations";

const app = new Hono();

// --- Middleware ---
app.use("*", cors());
app.use("*", logger());

// --- Health check ---
app.get("/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

// --- API v2 routes ---
const v2 = new Hono();

v2.route("/auth", auth);
v2.route("/groups", groups);
v2.route("/events", events);
v2.route("/golf", golf);
v2.route("/chat", chat);
v2.route("/media", media);
v2.route("/master", master);
v2.route("/flights", flights);
v2.route("/locations", locations);

app.route("/v2", v2);

// --- Serve uploaded media ---
app.use("/uploads/*", serveStatic({ root: "./" }));

// --- Serve static web app (production) ---
app.use("/assets/*", serveStatic({ root: "../web/dist" }));
app.get("/*", serveStatic({ root: "../web/dist", path: "index.html" }));

// --- Start server ---
const port = parseInt(process.env.API_PORT || "3000", 10);

console.log(`[Crew API] Starting on port ${port}`);
console.log(`[Crew API] Routes mounted under /v2/`);
console.log(`[Crew API] Health check at GET /health`);

export default {
  port,
  fetch: app.fetch,
};
