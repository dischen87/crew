const URL_REGEX = /https?:\/\/[^\s]+/;

interface LinkPreviewData {
  url: string;
  title?: string;
  description?: string;
  image_url?: string;
}

export function extractUrl(text: string): string | null {
  const match = text.match(URL_REGEX);
  return match ? match[0] : null;
}

export async function fetchLinkPreview(url: string): Promise<LinkPreviewData | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "CrewBot/1.0", Accept: "text/html" },
    });
    clearTimeout(timeout);

    if (!res.ok) return null;
    const html = await res.text();

    const ogTitle = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']*)["']/i);
    const ogDesc = html.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']*)["']/i);
    const ogImage = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']*)["']/i);
    const metaTitle = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    const metaDesc = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i);

    const title = decode(ogTitle?.[1] || metaTitle?.[1]);
    const description = decode(ogDesc?.[1] || metaDesc?.[1]);
    const image_url = ogImage?.[1];

    if (!title && !description && !image_url) return null;
    return { url, title, description, image_url };
  } catch {
    return null;
  }
}

function decode(s?: string): string | undefined {
  return s?.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}
