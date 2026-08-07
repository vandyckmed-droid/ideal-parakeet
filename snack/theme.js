// Palette and type scale, kept in step with src/theme/theme.ts.
//
// This is the Expo Snack build of the app. It exists because Snack is the only
// way onto a phone with no desktop at all, and Snack cannot take the real
// app as-is: it caps file sizes well below the 1.7MB bundled dataset, and it
// handles expo-router's file-based routing unevenly. So this variant streams
// the dataset over the network and navigates with plain state. The maths, the
// palette and the interaction design are the same.

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Appearance, Platform, useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const palettes = {
  dark: {
    bg: '#000000', surface: '#101013', surfaceAlt: '#17171C',
    border: '#26262E', hairline: '#1B1B21',
    text: '#FFFFFF', textMuted: '#9A9AA6', textFaint: '#5C5C68',
    up: '#00C853', down: '#FF4E3A', flat: '#9A9AA6',
    accent: '#00C853', accentMuted: 'rgba(0, 200, 83, 0.16)',
    warn: '#FFB020', warnMuted: 'rgba(255, 176, 32, 0.16)',
    scrim: 'rgba(0, 0, 0, 0.7)', fillOpacity: 0.22,
  },
  light: {
    bg: '#FFFFFF', surface: '#F6F7F9', surfaceAlt: '#EDEFF3',
    border: '#DCE0E6', hairline: '#E8EBEF',
    text: '#0B0B0F', textMuted: '#5F6672', textFaint: '#9AA1AD',
    up: '#00794A', down: '#C6301C', flat: '#5F6672',
    accent: '#00794A', accentMuted: 'rgba(0, 121, 74, 0.12)',
    warn: '#A15C00', warnMuted: 'rgba(161, 92, 0, 0.12)',
    scrim: 'rgba(0, 0, 0, 0.35)', fillOpacity: 0.16,
  },
};

export const space = (n) => n * 4;
export const radius = { sm: 6, md: 10, lg: 16, pill: 999 };

// Digits sit in columns the eye scans vertically, so they must not change
// width between rows.
export const mono = Platform.select({
  ios: { fontVariant: ['tabular-nums'] },
  android: { fontFamily: 'monospace' },
  default: { fontVariant: ['tabular-nums'] },
});

// --- colour maths ------------------------------------------------------------
// Only needed by the rank heatmap, which has to produce a continuum between two
// palette entries rather than pick from them.

function parseHex(hex) {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** `hex` at a given alpha, as an rgba() string. */
export function withAlpha(hex, alpha) {
  const [r, g, b] = parseHex(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Linear blend between two hex colours; `t` of 0 returns `from`. */
export function mixHex(from, to, t) {
  const a = parseHex(from);
  const b = parseHex(to);
  const k = Math.max(0, Math.min(1, t));
  const ch = (i) => Math.round(a[i] + (b[i] - a[i]) * k);
  return `rgb(${ch(0)}, ${ch(1)}, ${ch(2)})`;
}

export const type = {
  hero: { fontSize: 34, fontWeight: '700', letterSpacing: -0.8 },
  title: { fontSize: 22, fontWeight: '700', letterSpacing: -0.4 },
  heading: { fontSize: 17, fontWeight: '600', letterSpacing: -0.2 },
  body: { fontSize: 15, fontWeight: '500' },
  bodyStrong: { fontSize: 15, fontWeight: '600' },
  caption: { fontSize: 13, fontWeight: '500' },
  micro: { fontSize: 11, fontWeight: '600', letterSpacing: 0.4 },
};

const ThemeContext = createContext(null);
const KEY = 'parakeet.theme';

export function ThemeProvider({ children }) {
  const system = useColorScheme();
  const [preference, setPreferenceState] = useState('system');

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((v) => {
        if (v === 'light' || v === 'dark' || v === 'system') setPreferenceState(v);
      })
      .catch(() => {});
  }, []);

  const setPreference = (p) => {
    setPreferenceState(p);
    AsyncStorage.setItem(KEY, p).catch(() => {});
  };

  const resolved = system === 'dark' ? 'dark' : 'light';
  const scheme = preference === 'system' ? resolved : preference;

  const value = useMemo(
    () => ({ colors: palettes[scheme], scheme, preference, setPreference }),
    [scheme, preference]
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
export function useColors() {
  return useContext(ThemeContext).colors;
}
