import { Hono } from "hono";
import { sql } from "../db/client";
import { authMiddleware, getMember } from "../middleware/auth";

const chat = new Hono();
chat.use("*", authMiddleware);

/**
 * GET /:groupId/messages — Get messages (paginated).
 * Query params: limit (default 50), offset (default 0)
 */
chat.get("/:groupId/messages", async (c) => {
  try {
    const groupId = c.req.param("groupId");
    const limit = Math.min(parseInt(c.req.query("limit") || "50", 10), 100);
    const offset = parseInt(c.req.query("offset") || "0", 10);

    const messages = await sql`
      SELECT
        m.id, m.group_id, m.event_id, m.sender_id, m.content, m.type, m.media_url, m.created_at,
        gm.display_name AS sender_name,
        gm.avatar_emoji AS sender_emoji
      FROM messages m
      LEFT JOIN group_members gm ON gm.id = m.sender_id
      WHERE m.group_id = ${groupId}
      ORDER BY m.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const [{ count }] = await sql`
      SELECT COUNT(*)::int AS count FROM messages WHERE group_id = ${groupId}
    `;

    return c.json({ messages, total: count, limit, offset });
  } catch (err) {
    console.error("GET /chat/:groupId/messages error:", err);
    return c.json({ error: "Failed to fetch messages" }, 500);
  }
});

/**
 * POST /:groupId/messages — Send a message.
 * Body: { content: string, type?: string, event_id?: string, media_url?: string }
 */
chat.post("/:groupId/messages", async (c) => {
  try {
    const groupId = c.req.param("groupId");
    const member = getMember(c);
    const body = await c.req.json<{
      content: string;
      type?: string;
      event_id?: string;
      media_url?: string;
    }>();

    if (!body.content) {
      return c.json({ error: "content is required" }, 400);
    }

    const [message] = await sql`
      INSERT INTO messages (group_id, sender_id, content, type, event_id, media_url)
      VALUES (
        ${groupId},
        ${member.id},
        ${body.content},
        ${body.type ?? "text"},
        ${body.event_id ?? null},
        ${body.media_url ?? null}
      )
      RETURNING id, group_id, event_id, sender_id, content, type, media_url, created_at
    `;

    return c.json({ message }, 201);
  } catch (err) {
    console.error("POST /chat/:groupId/messages error:", err);
    return c.json({ error: "Failed to send message" }, 500);
  }
});

export default chat;
