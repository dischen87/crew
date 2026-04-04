import { Hono } from "hono";
import { sql } from "../db/client";
import { authMiddleware, getMember } from "../middleware/auth";
import { randomUUID } from "crypto";
import { join } from "path";

const media = new Hono();
media.use("*", authMiddleware);

const UPLOADS_DIR = join(import.meta.dir, "../../uploads");

/**
 * GET /event/:id — List media for an event.
 */
media.get("/event/:id", async (c) => {
  try {
    const eventId = c.req.param("id");

    const items = await sql`
      SELECT
        m.id, m.event_id, m.uploader_id, m.url, m.thumbnail, m.type, m.likes, m.caption, m.created_at,
        gm.display_name AS uploader_name
      FROM media m
      LEFT JOIN group_members gm ON gm.id = m.uploader_id
      WHERE m.event_id = ${eventId}
      ORDER BY m.created_at DESC
    `;

    return c.json({ media: items });
  } catch (err) {
    console.error("GET /media/event/:id error:", err);
    return c.json({ error: "Failed to fetch media" }, 500);
  }
});

/**
 * POST /event/:id/upload — Upload a file (staging: saves to ./uploads/).
 * Expects multipart form data with a "file" field. Optional "caption" field.
 */
media.post("/event/:id/upload", async (c) => {
  try {
    const eventId = c.req.param("id");
    const member = getMember(c);

    const formData = await c.req.formData();
    const file = formData.get("file") as File | null;
    const caption = formData.get("caption") as string | null;

    if (!file) {
      return c.json({ error: "file is required" }, 400);
    }

    // Determine file type from mime
    const isVideo = file.type.startsWith("video/");
    const mediaType = isVideo ? "video" : "image";
    const ext = file.name.split(".").pop() || "bin";
    const filename = `${randomUUID()}.${ext}`;
    const filePath = join(UPLOADS_DIR, filename);

    // Write file to disk
    const buffer = await file.arrayBuffer();
    await Bun.write(filePath, buffer);

    const url = `/uploads/${filename}`;

    const [record] = await sql`
      INSERT INTO media (event_id, uploader_id, url, type, caption)
      VALUES (${eventId}, ${member.id}, ${url}, ${mediaType}, ${caption})
      RETURNING id, event_id, uploader_id, url, thumbnail, type, likes, caption, created_at
    `;

    return c.json({ media: record }, 201);
  } catch (err) {
    console.error("POST /media/event/:id/upload error:", err);
    return c.json({ error: "Failed to upload media" }, 500);
  }
});

export default media;
