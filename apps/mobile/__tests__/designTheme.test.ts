import {
  accessibleTextColor,
  contrastRatio,
  contrastThresholds,
  meetsContrast,
  relativeLuminance,
} from '../src/design/contrast';
import {
  borders,
  colors,
  elevations,
  fontFamilies,
  motion,
  palette,
  radii,
  spacing,
  typography,
} from '../src/design/theme';

test('keeps the selected Crew Board visual anchors explicit', () => {
  expect(palette).toMatchObject({
    canvas: '#F0DDF5',
    gold: '#F5D565',
    ink: '#2D2D2D',
    lavender: '#D5C2E8',
    mint: '#C2E8D5',
    danger: '#8B1E3F',
  });
  expect(fontFamilies.brand).toBe('DM Sans');
  expect(typography).toMatchObject({
    body: { fontFamily: 'DM Sans', fontSize: 17, lineHeight: 24 },
    heading: { fontFamily: 'DM Sans', fontSize: 24, lineHeight: 28 },
  });
  expect(spacing).toMatchObject({ sm: 8, md: 12, lg: 16, xl: 24 });
  expect(borders.strong).toBe(3);
  expect(radii).toMatchObject({ card: 20, control: 14, pill: 999 });
  expect(elevations.control.shadowOffset).toEqual({ height: 3, width: 3 });
  expect(elevations.control.shadowRadius).toBe(0);
  expect(motion).toMatchObject({
    duration: { control: 150, press: 100 },
    press: { cardScale: 0.98, controlOffset: 2 },
  });
});

test.each([
  [colors.text, colors.background],
  [colors.text, colors.surface],
  [colors.text, colors.surfaceAction],
  [colors.text, colors.surfaceBrand],
  [colors.text, colors.surfaceAccent],
  [colors.textSecondary, colors.background],
  [colors.textSecondary, colors.surface],
  [colors.textSecondary, colors.surfaceAction],
  [colors.textSecondary, colors.surfaceBrand],
  [colors.textSecondary, colors.surfaceAccent],
  [colors.textInverse, colors.text],
])('%s remains AA-readable on %s', (foreground, background) => {
  expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(
    contrastThresholds.normalText,
  );
  expect(meetsContrast(foreground, background)).toBe(true);
});

test.each([
  colors.background,
  colors.surface,
  colors.surfaceAction,
  colors.surfaceBrand,
  colors.surfaceAccent,
])('strong outlines remain perceivable on %s', background => {
  expect(contrastRatio(colors.border, background)).toBeGreaterThanOrEqual(
    contrastThresholds.nonText,
  );
});

test.each([colors.surface, colors.background])(
  'error text remains AA-readable on %s',
  background => {
    expect(contrastRatio(colors.error, background)).toBeGreaterThanOrEqual(
      contrastThresholds.normalText,
    );
  },
);

test.each([colors.surface, colors.background])(
  'focus outlines remain perceivable on %s',
  background => {
    expect(contrastRatio(colors.focus, background)).toBeGreaterThanOrEqual(
      contrastThresholds.nonText,
    );
  },
);

test('chooses the higher-contrast semantic text color', () => {
  expect(accessibleTextColor(colors.surfaceBrand)).toBe(colors.text);
  expect(accessibleTextColor(colors.text)).toBe(colors.textInverse);
  expect(relativeLuminance('#000')).toBe(0);
  expect(relativeLuminance('#FFF')).toBe(1);
  expect(() => contrastRatio('transparent', colors.surface)).toThrow(
    /hex color/,
  );
});
