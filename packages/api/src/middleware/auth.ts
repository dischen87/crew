import type { Context, Next } from "hono";
import { sql } from "../db/client";

export interface Member {
  id: string;
  group_id: string;
  display_name: string;
  avatar_url: string | null;
  avatar_emoji: string | null;
  is_admin: boolean;
  joined_at: string;
}

/**
 * Auth middleware: accepts Authorization: Bearer <member_id> or X-Member-ID header.
 */
export async function authMiddleware(c: Context, next: Next) {
  let memberId = c.req.header("X-Member-ID");

  if (!memberId) {
    const authHeader = c.req.header("Authorization");
    if (authHeader?.startsWith("Bearer ")) {
      memberId = authHeader.slice(7);
    }
  }

  if (!memberId) {
    return c.json({ error: "Authentication required" }, 401);
  }

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(memberId)) {
    return c.json({ error: "Invalid member ID format" }, 400);
  }

  try {
    const [member] = await sql<Member[]>`
      SELECT id, group_id, display_name, avatar_url, avatar_emoji, is_admin, joined_at
      FROM group_members
      WHERE id = ${memberId}
    `;

    if (!member) {
      return c.json({ error: "Member not found" }, 404);
    }

    c.set("member", member);
    await next();
  } catch (err) {
    return c.json({ error: "Auth failed" }, 500);
  }
}

/**
 * Helper to get the authenticated member from context.
 */
export function getMember(c: Context): Member {
  return c.get("member") as Member;
}
