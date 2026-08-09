import AsyncStorage from '@react-native-async-storage/async-storage';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { MetricKey } from '../data/stats';
import {
  DateWindow,
  PresetKey,
  sessionsSinceSnapshot,
  windowForPreset,
} from '../data/windows';

type AppStateValue = {
  window: DateWindow;
  setPreset: (p: PresetKey) => void;
  setCustomWindow: (startIndex: number, endIndex: number) => void;

  metric: MetricKey;
  setMetric: (m: MetricKey) => void;

  /** Drop the recent tail of every window; see `withSkip`. */
  skipEnabled: boolean;
  setSkipEnabled: (v: boolean) => void;

  /** Trading sessions between the newest bar and today; see `withSkip`. */
  sessionsStale: number;

  watchlist: string[];
  isWatched: (symbol: string) => boolean;
  toggleWatch: (symbol: string) => boolean;
  clearWatchlist: () => void;

  /**
   * The families picked for comparison - the family analogue of the
   * watchlist. Tap a family row to collect it here; any family's detail
   * chart overlays the set. Session-local on purpose: a comparison is a
   * question being asked now, not a portfolio being kept.
   */
  familyCompare: string[];
  toggleFamilyCompare: (key: string) => boolean;
};

const AppStateContext = createContext<AppStateValue | null>(null);
const WATCHLIST_KEY = 'parakeet.watchlist';
const SKIP_KEY = 'parakeet.skip';

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [window, setWindow] = useState<DateWindow>(() => windowForPreset('1Y'));
  const [metric, setMetric] = useState<MetricKey>('return');
  const [skipEnabled, setSkipEnabledState] = useState(false);
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);

  // Read once per launch. Re-reading on every render would make window maths
  // depend on wall-clock time, and the value only moves at midnight anyway.
  const [sessionsStale] = useState(() => sessionsSinceSnapshot());

  useEffect(() => {
    AsyncStorage.getItem(WATCHLIST_KEY)
      .then((saved) => {
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) setWatchlist(parsed.filter((s) => typeof s === 'string'));
        }
      })
      .catch(() => {
        /* a corrupt entry just starts the user with an empty watchlist */
      })
      .finally(() => setHydrated(true));

    AsyncStorage.getItem(SKIP_KEY)
      .then((saved) => setSkipEnabledState(saved === '1'))
      .catch(() => {});
  }, []);

  const setSkipEnabled = useCallback((v: boolean) => {
    setSkipEnabledState(v);
    AsyncStorage.setItem(SKIP_KEY, v ? '1' : '0').catch(() => {});
  }, []);

  // Guarded on `hydrated` so the initial empty state cannot race ahead of the
  // load and wipe a saved watchlist.
  useEffect(() => {
    if (hydrated) AsyncStorage.setItem(WATCHLIST_KEY, JSON.stringify(watchlist));
  }, [watchlist, hydrated]);

  const setPreset = useCallback((p: PresetKey) => setWindow(windowForPreset(p)), []);

  const setCustomWindow = useCallback((startIndex: number, endIndex: number) => {
    setWindow({
      startIndex: Math.min(startIndex, endIndex),
      endIndex: Math.max(startIndex, endIndex),
      preset: 'CUSTOM',
    });
  }, []);

  const watchSet = useMemo(() => new Set(watchlist), [watchlist]);
  const isWatched = useCallback((s: string) => watchSet.has(s), [watchSet]);

  /** Returns the resulting state so callers can pick the right haptic. */
  const toggleWatch = useCallback(
    (symbol: string) => {
      setWatchlist((prev) =>
        prev.includes(symbol)
          ? prev.filter((s) => s !== symbol)
          : [...prev, symbol]
      );
      return !watchSet.has(symbol);
    },
    [watchSet]
  );

  const clearWatchlist = useCallback(() => setWatchlist([]), []);

  const [familyCompare, setFamilyCompare] = useState<string[]>([]);
  /** Returns the resulting state so callers can pick the right haptic. */
  const toggleFamilyCompare = useCallback((key: string) => {
    let added = false;
    setFamilyCompare((prev) => {
      if (prev.includes(key)) return prev.filter((k) => k !== key);
      added = true;
      // Four lines is where a comparison chart stops being readable; the
      // oldest pick rolls off, same as the market-view rule always was.
      const next = [...prev, key];
      return next.length > 4 ? next.slice(1) : next;
    });
    return added;
  }, []);

  const value = useMemo(
    () => ({
      window,
      setPreset,
      setCustomWindow,
      metric,
      setMetric,
      skipEnabled,
      setSkipEnabled,
      sessionsStale,
      watchlist,
      isWatched,
      toggleWatch,
      clearWatchlist,
      familyCompare,
      toggleFamilyCompare,
    }),
    [
      window, setPreset, setCustomWindow, metric, skipEnabled, setSkipEnabled,
      sessionsStale, watchlist, isWatched, toggleWatch, clearWatchlist,
      familyCompare, toggleFamilyCompare,
    ]
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState() {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error('useAppState must be used inside AppStateProvider');
  return ctx;
}
