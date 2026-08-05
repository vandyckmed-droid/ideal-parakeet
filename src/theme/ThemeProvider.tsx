import AsyncStorage from '@react-native-async-storage/async-storage';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useColorScheme } from 'react-native';

import { Palette, palettes } from './theme';

export type ThemePreference = 'system' | 'light' | 'dark';

type ThemeContextValue = {
  colors: Palette;
  scheme: 'light' | 'dark';
  preference: ThemePreference;
  setPreference: (p: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);
const STORAGE_KEY = 'parakeet.theme';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>('system');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((saved) => {
      if (saved === 'light' || saved === 'dark' || saved === 'system') {
        setPreferenceState(saved);
      }
    });
  }, []);

  const setPreference = useCallback((p: ThemePreference) => {
    setPreferenceState(p);
    AsyncStorage.setItem(STORAGE_KEY, p);
  }, []);

  // useColorScheme can report a value the palettes do not cover (null, or
  // 'unspecified' on Android before the system setting resolves); light is the
  // safe default in every one of those cases.
  const resolved: 'light' | 'dark' = system === 'dark' ? 'dark' : 'light';
  const scheme: 'light' | 'dark' = preference === 'system' ? resolved : preference;

  const value = useMemo(
    () => ({ colors: palettes[scheme], scheme, preference, setPreference }),
    [scheme, preference, setPreference]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}

/** Convenience for the common case of only needing the palette. */
export function useColors() {
  return useTheme().colors;
}
