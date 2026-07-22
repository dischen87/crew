import type { TextStyle, ViewStyle } from 'react-native';

export const palette = {
  canvas: '#F0DDF5',
  canvasPressed: '#E8D3F0',
  paper: '#FFFFFF',
  ink: '#2D2D2D',
  gold: '#F5D565',
  goldPressed: '#EBC94E',
  mint: '#C2E8D5',
  mintPressed: '#A3D4BE',
  lavender: '#D5C2E8',
  purple: '#5A487F',
  danger: '#8B1E3F',
  divider: '#A99EAE',
} as const;

export const colors = {
  background: palette.canvas,
  backgroundPressed: palette.canvasPressed,
  surface: palette.paper,
  surfaceBrand: palette.gold,
  surfaceBrandPressed: palette.goldPressed,
  surfaceAction: palette.mint,
  surfaceActionPressed: palette.mintPressed,
  surfaceAccent: palette.lavender,
  text: palette.ink,
  textSecondary: palette.purple,
  textInverse: palette.paper,
  border: palette.ink,
  divider: palette.divider,
  error: palette.danger,
  focus: palette.purple,
} as const;

export const fontFamilies = {
  brand: 'DM Sans',
} as const;

export const typography = {
  display: {
    fontFamily: fontFamilies.brand,
    fontSize: 40,
    fontWeight: '800',
    letterSpacing: -1.2,
    lineHeight: 44,
  },
  title: {
    fontFamily: fontFamilies.brand,
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: -0.8,
    lineHeight: 36,
  },
  heading: {
    fontFamily: fontFamilies.brand,
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.4,
    lineHeight: 28,
  },
  subheading: {
    fontFamily: fontFamilies.brand,
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.2,
    lineHeight: 24,
  },
  body: {
    fontFamily: fontFamilies.brand,
    fontSize: 17,
    fontWeight: '400',
    lineHeight: 24,
  },
  bodyStrong: {
    fontFamily: fontFamilies.brand,
    fontSize: 17,
    fontWeight: '700',
    lineHeight: 24,
  },
  label: {
    fontFamily: fontFamilies.brand,
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 18,
  },
  caption: {
    fontFamily: fontFamilies.brand,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
  },
  overline: {
    fontFamily: fontFamilies.brand,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    lineHeight: 14,
    textTransform: 'uppercase',
  },
  numeric: {
    fontFamily: fontFamilies.brand,
    fontSize: 28,
    fontVariant: ['tabular-nums'],
    fontWeight: '800',
    lineHeight: 32,
  },
} as const satisfies Record<string, TextStyle>;

export const spacing = {
  none: 0,
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 40,
  jumbo: 48,
} as const;

export const radii = {
  compact: 12,
  control: 14,
  card: 20,
  navigation: 20,
  pill: 999,
} as const;

export const borders = {
  subtle: 1,
  chip: 2,
  strong: 3,
} as const;

const hardShadow = (distance: number, elevation: number): ViewStyle => ({
  elevation,
  shadowColor: colors.border,
  shadowOffset: { height: distance, width: distance },
  shadowOpacity: 1,
  shadowRadius: 0,
});

export const elevations = {
  flat: {} satisfies ViewStyle,
  compact: hardShadow(2, 2),
  control: hardShadow(3, 3),
  card: hardShadow(4, 4),
  pressed: hardShadow(1, 1),
} as const;

export const motion = {
  duration: {
    reduced: 0,
    press: 100,
    control: 150,
    focus: 200,
    entrance: 500,
  },
  easing: {
    expressive: [0.16, 0.84, 0.44, 1],
  },
  press: {
    cardScale: 0.98,
    controlOffset: 2,
  },
} as const;

export const componentMetrics = {
  avatar: {
    maxVisible: 7,
    overlap: 10,
    size: 40,
  },
  control: {
    disabledOpacity: 0.42,
    minimumTouchSize: 48,
  },
  navigation: {
    minimumItemHeight: 56,
  },
  status: {
    chipMinimumHeight: 28,
    indicatorSize: 28,
  },
  timeline: {
    iconSize: 40,
    minimumRowHeight: 72,
    timeColumnWidth: 68,
  },
} as const;

export const crewTheme = {
  borders,
  colors,
  componentMetrics,
  elevations,
  fontFamilies,
  motion,
  palette,
  radii,
  spacing,
  typography,
} as const;
