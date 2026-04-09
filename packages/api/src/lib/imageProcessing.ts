import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: "fsn1",
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY || "",
    secretAccessKey: process.env.S3_SECRET_KEY || "",
  },
  forcePathStyle: true,
});

const BUCKET = process.env.S3_BUCKET || "crew-media";

interface ImageVariants {
  thumbnail: string;
  preview: string;
  original: string;
}

export async function generateThumbnails(
  originalKey: string
): Promise<ImageVariants | null> {
  try {
    // Fetch original from S3
    const getCmd = new GetObjectCommand({ Bucket: BUCKET, Key: originalKey });
    const obj = await s3.send(getCmd);
    const body = await obj.Body?.transformToByteArray();

    if (!body) return null;

    const basePath = originalKey.replace(/\.[^.]+$/, "");

    // Try to use sharp for image processing
    let sharp: any;
    try {
      sharp = (await import("sharp")).default;
    } catch {
      // sharp not available - store original URL for all variants
      const publicUrl = `${process.env.S3_ENDPOINT}/${BUCKET}/${originalKey}`;
      return {
        thumbnail: publicUrl,
        preview: publicUrl,
        original: publicUrl,
      };
    }

    // Generate thumbnail (200x200, cover crop)
    const thumbBuffer = await sharp(body)
      .resize(200, 200, { fit: "cover" })
      .webp({ quality: 70 })
      .toBuffer();

    const thumbKey = `${basePath}_thumb.webp`;
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: thumbKey,
        Body: thumbBuffer,
        ContentType: "image/webp",
        CacheControl: "public, max-age=31536000, immutable",
      })
    );

    // Generate preview (800px wide)
    const previewBuffer = await sharp(body)
      .resize(800, null, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();

    const previewKey = `${basePath}_preview.webp`;
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: previewKey,
        Body: previewBuffer,
        ContentType: "image/webp",
        CacheControl: "public, max-age=31536000, immutable",
      })
    );

    // Set cache headers on original
    const originalWebp = await sharp(body).webp({ quality: 85 }).toBuffer();
    const originalWebpKey = `${basePath}_original.webp`;
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: originalWebpKey,
        Body: originalWebp,
        ContentType: "image/webp",
        CacheControl: "public, max-age=31536000, immutable",
      })
    );

    const baseUrl = `${process.env.S3_ENDPOINT}/${BUCKET}`;
    return {
      thumbnail: `${baseUrl}/${thumbKey}`,
      preview: `${baseUrl}/${previewKey}`,
      original: `${baseUrl}/${originalWebpKey}`,
    };
  } catch (err) {
    console.error("Image processing failed:", err);
    return null;
  }
}
