import { Platform, TextStyle } from 'react-native';

/**
 * Two palettes drawn from the apps this borrows from.
 *
 * Robinhood supplies the dark scheme's structure: true black rather than grey,
 * so OLED panels render the background as off pixels and the numbers appear to
 * float. Fidelity supplies the light scheme's restraint and its deeper,
 * desaturated green, which stays legible against white where Robinhood's
 * neon green would vibrate.
 */
export type Palette = {
  bg: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  hairline: string;
  text: string;
  textMuted: string;
  textFaint: string;
  up: string;
  down: string;
  flat: string;
  accent: string;
  accentMuted: string;
  /** Reserved for overlap/concentration flags - never used for return sign. */
  warn: string;
  warnMuted: string;
  chartFillTop: string;
  chartFillBottom: string;
  scrim: string;
  /**
   * Categorical hues for multi-line comparison charts, in selection order.
   * Deliberately excludes the up/down green and red, which carry return sign
   * everywhere else and must not be spent on telling lines apart.
   */
  chart: string[];
};

const dark: Palette = {
  bg: '#000000',
  surface: '#101013',
  surfaceAlt: '#17171C',
  border: '#26262E',
  hairline: '#1B1B21',
  text: '#FFFFFF',
  textMuted: '#9A9AA6',
  textFaint: '#5C5C68',
  up: '#00C853',
  down: '#FF4E3A',
  flat: '#9A9AA6',
  accent: '#00C853',
  accentMuted: 'rgba(0, 200, 83, 0.16)',
  warn: '#FFB020',
  warnMuted: 'rgba(255, 176, 32, 0.16)',
  chartFillTop: 'rgba(0, 200, 83, 0.22)',
  chartFillBottom: 'rgba(0, 200, 83, 0)',
  scrim: 'rgba(0, 0, 0, 0.7)',
  chart: ['#5B9DFF', '#F5A524', '#A78BFA', '#2DD4BF'],
};

const light: Palette = {
  bg: '#FFFFFF',
  surface: '#F6F7F9',
  surfaceAlt: '#EDEFF3',
  border: '#DCE0E6',
  hairline: '#E8EBEF',
  text: '#0B0B0F',
  textMuted: '#5F6672',
  textFaint: '#9AA1AD',
  up: '#00794A',
  down: '#C6301C',
  flat: '#5F6672',
  accent: '#00794A',
  accentMuted: 'rgba(0, 121, 74, 0.12)',
  warn: '#A15C00',
  warnMuted: 'rgba(161, 92, 0, 0.12)',
  chartFillTop: 'rgba(0, 121, 74, 0.16)',
  chartFillBottom: 'rgba(0, 121, 74, 0)',
  scrim: 'rgba(0, 0, 0, 0.35)',
  chart: ['#2563EB', '#B45309', '#7C3AED', '#0F766E'],
};

export const palettes = { dark, light };

export const space = (n: number) => n * 4;

export const radius = {
  sm: 6,
  md: 10,
  lg: 16,
  pill: 999,
};

/**
 * Every figure in this app sits in a column that the eye scans vertically, so
 * digits must not change width between rows. Both platforms expose tabular
 * figures, just under different names.
 */
export const mono: TextStyle = Platform.select<TextStyle>({
  ios: { fontVariant: ['tabular-nums'] },
  android: { fontFamily: 'monospace' },
  default: { fontVariant: ['tabular-nums'] },
})!;

// --- colour maths ------------------------------------------------------------
// Only needed by the rank heatmap, which has to produce a continuum between two
// palette entries rather than pick from them.

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** `hex` at a given alpha, as an rgba() string. */
export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = parseHex(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Linear blend between two hex colours; `t` of 0 returns `from`. */
export function mixHex(from: string, to: string, t: number): string {
  const a = parseHex(from);
  const b = parseHex(to);
  const k = Math.max(0, Math.min(1, t));
  const ch = (i: number) => Math.round(a[i] + (b[i] - a[i]) * k);
  return `rgb(${ch(0)}, ${ch(1)}, ${ch(2)})`;
}

export const type = {
  hero: { fontSize: 34, fontWeight: '700' as const, letterSpacing: -0.8 },
  title: { fontSize: 22, fontWeight: '700' as const, letterSpacing: -0.4 },
  heading: { fontSize: 17, fontWeight: '600' as const, letterSpacing: -0.2 },
  body: { fontSize: 15, fontWeight: '500' as const },
  bodyStrong: { fontSize: 15, fontWeight: '600' as const },
  caption: { fontSize: 13, fontWeight: '500' as const },
  micro: { fontSize: 11, fontWeight: '600' as const, letterSpacing: 0.4 },
};
