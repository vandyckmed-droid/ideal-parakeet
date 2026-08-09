import AsyncStorage from '@react-native-async-storage/async-storage';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { DEFAULT_K, K_CHOICES } from '../data/groups';
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
   * How many correlation groups to cut the universe into. Persisted: it
   * changes what the whole Groups view means, which makes it a setting rather
   * than a glance.
   */
  groupCount: number;
  setGroupCount: (k: number) => void;

  /**
   * The groups picked for comparison - the group analogue of the watchlist.
   * Tap a group row to collect it here; any group's detail chart overlays the
   * set. Session-local on purpose: a comparison is a question being asked
   * now, not a portfolio being kept.
   */
  familyCompare: string[];
  /**
   * Chart-colour slot per collected family. A slot is claimed on collect
   * and held until release, so releasing one family never recolours the
   * rest and the detail chart always matches the list's dots. Colouring by
   * list position instead is exactly the bug this exists to prevent.
   */
  familySlots: Record<string, number>;
  toggleFamilyCompare: (key: string) => boolean;
};

const AppStateContext = createContext<AppStateValue | null>(null);
const WATCHLIST_KEY = 'parakeet.watchlist';
const SKIP_KEY = 'parakeet.skip';
const GROUP_COUNT_KEY = 'parakeet.groupCount';

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [window, setWindow] = useState<DateWindow>(() => windowForPreset('1Y'));
  const [metric, setMetric] = useState<MetricKey>('return');
  const [skipEnabled, setSkipEnabledState] = useState(false);
  const [groupCount, setGroupCountState] = useState(DEFAULT_K);
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

    AsyncStorage.getItem(GROUP_COUNT_KEY)
      .then((saved) => {
        const k = Number(saved);
        // Only accept a K the app still offers, so a stale value from an older
        // build cannot leave the view on a setting the picker cannot show.
        if (K_CHOICES.includes(k)) setGroupCountState(k);
      })
      .catch(() => {});
  }, []);

  const setSkipEnabled = useCallback((v: boolean) => {
    setSkipEnabledState(v);
    AsyncStorage.setItem(SKIP_KEY, v ? '1' : '0').catch(() => {});
  }, []);

  const setGroupCount = useCallback((k: number) => {
    setGroupCountState(k);
    AsyncStorage.setItem(GROUP_COUNT_KEY, String(k)).catch(() => {});
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

  // Order (for the oldest-rolls-off rule) and colour slots are tracked
  // separately: eviction is by age, but colour is by slot, and conflating
  // them is what made every remaining family change colour on a release.
  const [familyCompareState, setFamilyCompareState] = useState<{
    order: string[];
    slots: Record<string, number>;
  }>({ order: [], slots: {} });

  /** Returns the resulting state so callers can pick the right haptic. */
  const toggleFamilyCompare = useCallback((key: string) => {
    let added = false;
    setFamilyCompareState((prev) => {
      if (prev.order.includes(key)) {
        const slots = { ...prev.slots };
        delete slots[key];
        return { order: prev.order.filter((k) => k !== key), slots };
      }
      added = true;
      let order = prev.order;
      const slots = { ...prev.slots };
      // Four lines is where a comparison chart stops being readable; the
      // oldest pick rolls off and only ITS slot is freed.
      if (order.length >= 4) {
        delete slots[order[0]];
        order = order.slice(1);
      }
      const used = new Set(Object.values(slots));
      let slot = 0;
      while (used.has(slot)) slot++;
      slots[key] = slot;
      return { order: [...order, key], slots };
    });
    return added;
  }, []);
  const familyCompare = familyCompareState.order;
  const familySlots = familyCompareState.slots;

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
      groupCount,
      setGroupCount,
      familyCompare,
      familySlots,
      toggleFamilyCompare,
    }),
    [
      window, setPreset, setCustomWindow, metric, skipEnabled, setSkipEnabled,
      sessionsStale, watchlist, isWatched, toggleWatch, clearWatchlist,
      groupCount, setGroupCount, familyCompare, familySlots, toggleFamilyCompare,
    ]
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState() {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error('useAppState must be used inside AppStateProvider');
  return ctx;
}
