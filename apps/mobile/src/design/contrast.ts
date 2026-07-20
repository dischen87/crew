import { colors } from './theme';

export const contrastThresholds = {
  largeText: 3,
  nonText: 3,
  normalText: 4.5,
} as const;

function rgb(hex: string): [number, number, number] {
  const value = hex.trim();
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);

  if (!match) {
    throw new Error(
      `Expected a three- or six-digit hex color, received ${hex}`,
    );
  }

  const expanded =
    match[1].length === 3
      ? match[1]
          .split('')
          .map(character => character + character)
          .join('')
      : match[1];

  return [0, 2, 4].map(offset =>
    Number.parseInt(expanded.slice(offset, offset + 2), 16),
  ) as [number, number, number];
}

export function relativeLuminance(hex: string): number {
  const [red, green, blue] = rgb(hex).map(channel => {
    const value = channel / 255;
    return value <= 0.04045
      ? value / 12.92
      : Math.pow((value + 0.055) / 1.055, 2.4);
  });

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

export function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);

  return (lighter + 0.05) / (darker + 0.05);
}

export function meetsContrast(
  foreground: string,
  background: string,
  threshold = contrastThresholds.normalText,
): boolean {
  return contrastRatio(foreground, background) >= threshold;
}

export function accessibleTextColor(background: string): string {
  return contrastRatio(colors.text, background) >=
    contrastRatio(colors.textInverse, background)
    ? colors.text
    : colors.textInverse;
}
