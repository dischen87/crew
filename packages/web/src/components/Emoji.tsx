/**
 * Renders emojis as Twemoji SVGs instead of native platform emojis.
 * Consistent look across all devices, higher quality, more "designed" feel.
 */

function emojiToCodepoints(emoji: string): string {
  const codepoints: string[] = [];
  for (const char of emoji) {
    const cp = char.codePointAt(0);
    if (cp && cp !== 0xfe0f) {
      codepoints.push(cp.toString(16));
    }
  }
  return codepoints.join("-");
}

const CDN_BASE = "https://cdn.jsdelivr.net/gh/twitter/twemoji@latest/assets/svg";

interface EmojiProps {
  emoji: string;
  size?: number;
  className?: string;
}

export default function Emoji({ emoji, size = 24, className = "" }: EmojiProps) {
  if (!emoji) return null;
  const codepoints = emojiToCodepoints(emoji);
  return (
    <img
      src={`${CDN_BASE}/${codepoints}.svg`}
      alt={emoji}
      width={size}
      height={size}
      className={`inline-block ${className}`}
      draggable={false}
      loading="lazy"
    />
  );
}
