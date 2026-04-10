import type { Context, Next } from "hono";

/**
 * Global error handler middleware for Hono.
 * Catches unhandled errors in routes and returns consistent JSON responses.
 */
export async function errorHandler(c: Context, next: Next) {
  try {
    await next();
  } catch (err: any) {
    const status = err.status || 500;
    const message = err.message || "Internal server error";

    if (status >= 500) {
      console.error(`[${c.req.method} ${c.req.path}] Error:`, err);
    }

    return c.json({ error: message }, status);
  }
}
