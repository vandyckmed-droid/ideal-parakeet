// Parakeet - the S&P 500, with a selectable return
// window and a risk-adjusted view of that same window.
//
// Expo Snack build. The dataset is fetched from the public repo rather than
// bundled, because Snack caps file sizes well below its 1.7MB, and navigation
// is plain state rather than expo-router, which Snack handles unevenly.
// Everything else - the maths, the palette, the interactions - matches the
// native app in the same repository.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Pressable, SafeAreaView, StatusBar, StyleSheet, Text, View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { ThemeProvider, useTheme, radius, space, type } from './theme';
import { sessionsSinceSnapshot, setMarket, windowForPreset } from './stats';
import { computeOverlap, describeCandidateOverlap } from './overlap';
import { ListScreen } from './ListScreen';
import { MarketScreen } from './Market';
import { ResearchScreen } from './Research';
import { DetailScreen } from './DetailScreen';
import { GroupDetailScreen } from './GroupDetail';
import { setGrouping } from './grouping';
import {
  DEFAULT_K, K_CHOICES, groupIndexFor, groupingMeta, groupsForK, setUniverse,
} from './groups';

// Main first; the working branch second so a payload shape that has not
// merged yet still reaches the phone. Once main carries it the first URL
// always wins - and main is the one the nightly job refreshes.
const DATA_URLS = [
  'https://raw.githubusercontent.com/vandyckmed-droid/ideal-parakeet/main/assets/data/market.json',
  'https://raw.githubusercontent.com/vandyckmed-droid/ideal-parakeet/claude/stock-watchlist-app-ju7qxb/assets/data/market.json',
];
const RESEARCH_URLS = [
  'https://raw.githubusercontent.com/vandyckmed-droid/ideal-parakeet/main/assets/data/research.json',
  'https://raw.githubusercontent.com/vandyckmed-droid/ideal-parakeet/claude/stock-watchlist-app-ju7qxb/assets/data/research.json',
];
const WATCHLIST_KEY = 'parakeet.watchlist';
const SKIP_KEY = 'parakeet.skip';
const GROUP_COUNT_KEY = 'parakeet.groupCount';

function Shell() {
  const { colors, scheme } = useTheme();

  const [data, setData] = useState(null);
  const [research, setResearch] = useState(null);
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);

  const [tab, setTab] = useState('market');
  const [order, setOrder] = useState([]);

  // Detail navigation is a stack: family pages open tickers and ticker pages
  // open families, and back has to walk home through whatever path the user
  // actually took.
  const [stack, setStack] = useState([]);
  const pushTicker = useCallback(
    (s) => setStack((st) => [...st, { kind: 'ticker', key: s }]),
    []
  );
  const pushFamily = useCallback(
    (key, famOrder) => setStack((st) => [...st, { kind: 'family', key, order: famOrder || null }]),
    []
  );
  const popDetail = useCallback(() => setStack((st) => st.slice(0, -1)), []);

  // The families picked for comparison - the family analogue of the
  // watchlist. Session-local on purpose: a comparison is a question being
  // asked now, not a portfolio being kept.
  //
  // Order (for the oldest-rolls-off rule) and colour slots are tracked
  // separately: eviction is by age, but colour is by slot, held from collect
  // to release - conflating them made every remaining family change colour
  // whenever one was released.
  const [familyCompareState, setFamilyCompareState] = useState({ order: [], slots: {} });
  const toggleFamilyCompare = useCallback((key) => {
    setFamilyCompareState((prev) => {
      if (prev.order.includes(key)) {
        const slots = { ...prev.slots };
        delete slots[key];
        return { order: prev.order.filter((k) => k !== key), slots };
      }
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
  }, []);
  const familyCompare = familyCompareState.order;
  const familySlots = familyCompareState.slots;

  const [win, setWin] = useState(null);
  const [metric, setMetric] = useState('return');
  const [skipEnabled, setSkipEnabledState] = useState(false);
  const [groupCount, setGroupCountState] = useState(DEFAULT_K);
  const [sessionsStale, setSessionsStale] = useState(0);
  const [watchlist, setWatchlist] = useState([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    (async () => {
      let lastErr = null;
      for (let u = 0; u < DATA_URLS.length; u++) {
        try {
          const r = await fetch(DATA_URLS[u]);
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const json = await r.json();
          // A payload without the market reference predates the residual
          // metric - the branch's copy has it, so keep looking before
          // settling for a shape that would leave every residual blank.
          if (!json.market && u < DATA_URLS.length - 1) continue;
          if (cancelled) return;
          // The residual metric measures each name against this; hand it over
          // before anything computes a window.
          setMarket(json.market);
          // The grouping matrix must be in place before anything clusters.
          setGrouping(json.grouping);
          // Cache the last close per name so rows do not walk the array to find it.
          const tickers = json.tickers.map((t) => ({ ...t, last: t.p[t.p.length - 1] }));
          const bySymbol = new Map(tickers.map((t) => [t.s, t]));
          setUniverse(bySymbol, json.dates.length - 1);
          setData({
            dates: json.dates,
            tickers,
            bySymbol,
            sectors: Array.from(new Set(tickers.map((t) => t.se))).sort(),
            generatedAt: json.generatedAt,
          });
          // Read once per load: window maths must not depend on wall-clock time.
          setSessionsStale(sessionsSinceSnapshot(json.dates));
          setWin(windowForPreset('1Y', json.dates));
          return;
        } catch (e) {
          lastErr = e;
        }
      }
      if (!cancelled) setError((lastErr && lastErr.message) || String(lastErr || 'no data'));
    })();
    // Optional: the app is fully usable without it, so a failure here only
    // leaves the Research tab explaining itself.
    (async () => {
      for (const url of RESEARCH_URLS) {
        try {
          const r = await fetch(url);
          if (!r.ok) continue;
          const json = await r.json();
          if (!cancelled) setResearch(json);
          return;
        } catch {}
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  useEffect(() => {
    AsyncStorage.getItem(WATCHLIST_KEY)
      .then((raw) => {
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) setWatchlist(parsed.filter((x) => typeof x === 'string'));
        }
      })
      .catch(() => {})
      .finally(() => setHydrated(true));

    AsyncStorage.getItem(SKIP_KEY)
      .then((v) => setSkipEnabledState(v === '1'))
      .catch(() => {});

    AsyncStorage.getItem(GROUP_COUNT_KEY)
      .then((v) => {
        // Only accept a K the app still offers, so a stale value from an older
        // build cannot leave the view on a setting the picker cannot show.
        const k = Number(v);
        if (K_CHOICES.includes(k)) setGroupCountState(k);
      })
      .catch(() => {});
  }, []);

  const setSkipEnabled = useCallback((v) => {
    setSkipEnabledState(v);
    AsyncStorage.setItem(SKIP_KEY, v ? '1' : '0').catch(() => {});
  }, []);

  const setGroupCount = useCallback((k) => {
    setGroupCountState(k);
    AsyncStorage.setItem(GROUP_COUNT_KEY, String(k)).catch(() => {});
  }, []);

  // Guarded on `hydrated` so the initial empty state cannot race ahead of the
  // load and wipe a saved watchlist.
  useEffect(() => {
    if (hydrated) AsyncStorage.setItem(WATCHLIST_KEY, JSON.stringify(watchlist)).catch(() => {});
  }, [watchlist, hydrated]);

  const watchSet = useMemo(() => new Set(watchlist), [watchlist]);
  const isWatched = useCallback((s) => watchSet.has(s), [watchSet]);
  const toggleWatch = useCallback((s) => {
    setWatchlist((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : prev.concat(s)));
  }, []);

  const setPreset = useCallback(
    (p) => setWin(windowForPreset(p, data.dates)),
    [data]
  );

  // Above the early returns: hooks must run in the same order every render.
  const groupSet = useMemo(
    () => (data ? groupsForK(groupCount) : { groups: [], lower: 0, upper: 0 }),
    [data, groupCount]
  );
  const famOf = useMemo(() => (data ? groupIndexFor(groupCount) : new Map()), [data, groupCount]);
  const setCustomWindow = useCallback(
    (a, b) => setWin({ startIndex: Math.min(a, b), endIndex: Math.max(a, b), preset: 'CUSTOM' }),
    []
  );

  if (error) {
    return (
      <View style={[s.centre, { backgroundColor: colors.bg }]}>
        <Text style={[type.title, { color: colors.text }]}>Couldn’t load prices</Text>
        <Text style={[type.caption, s.centreText, { color: colors.textMuted }]}>
          {error}. Check your connection and try again.
        </Text>
        <Pressable
          onPress={() => setAttempt((n) => n + 1)}
          style={[s.retry, { backgroundColor: colors.accent }]}
        >
          <Text style={[type.bodyStrong, { color: colors.bg }]}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (!data || !win) {
    return (
      <View style={[s.centre, { backgroundColor: colors.bg }]}>
        <ActivityIndicator color={colors.accent} />
        <Text style={[type.caption, { color: colors.textMuted }]}>Loading the S&P 500…</Text>
      </View>
    );
  }

  const top = stack.length ? stack[stack.length - 1] : null;
  if (top && top.kind === 'ticker') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
        <StatusBar barStyle={scheme === 'dark' ? 'light-content' : 'dark-content'} />
        <DetailScreen
          symbols={order.length ? order : data.tickers.map((t) => t.s)}
          bySymbol={data.bySymbol}
          dates={data.dates}
          initialSymbol={top.key}
          preset={win.preset}
          skipEnabled={skipEnabled}
          sessionsStale={sessionsStale}
          isWatched={isWatched}
          toggleWatch={toggleWatch}
          familyOf={famOf}
          onOpenFamily={(fam) => pushFamily(fam, null)}
          onBack={popDetail}
        />
      </SafeAreaView>
    );
  }
  if (top && top.kind === 'family') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
        <StatusBar barStyle={scheme === 'dark' ? 'light-content' : 'dark-content'} />
        <GroupDetailScreen
          families={groupSet.groups}
          bySymbol={data.bySymbol}
          dates={data.dates}
          initialKey={top.key}
          order={top.order}
          preset={win.preset}
          skipEnabled={skipEnabled}
          sessionsStale={sessionsStale}
          familyCompare={familyCompare}
          familySlots={familySlots}
          meta={groupingMeta()}
          bounds={{ lower: groupSet.lower, upper: groupSet.upper }}
          toggleFamilyCompare={toggleFamilyCompare}
          isWatched={isWatched}
          toggleWatch={toggleWatch}
          onOpenTicker={pushTicker}
          onBack={popDetail}
        />
      </SafeAreaView>
    );
  }

  const watched = watchlist.map((sym) => data.bySymbol.get(sym)).filter(Boolean);

  // The full selected window, not the skip-adjusted range: the skip exists to
  // exclude short-term reversal from a return measurement, which has no
  // bearing on how two return series co-move across the window as a whole.
  //
  // Market scores the whole universe against the watchlist basket - a badge
  // there means "adding this wouldn't diversify anything," whether or not
  // it's already held. Watchlist scores only its own members (no reason to
  // score 494 names it will never render).
  const overlap =
    tab === 'market'
      ? computeOverlap(watched, data.tickers, win.startIndex, win.endIndex)
      : computeOverlap(watched, watched, win.startIndex, win.endIndex);

  // Only the Market screen says anything under its title. The Watchlist shows
  // nothing between the title and the search box - the numbers that belong to
  // a name belong on that name's row.
  const overlapCaption =
    tab === 'market' ? describeCandidateOverlap(overlap, watched.length) : null;

  const tabBar = (
    <View style={[s.tabs, { backgroundColor: colors.bg, borderTopColor: colors.hairline }]}>
      {[
        { key: 'market', label: 'Market', glyph: '◫' },
        { key: 'research', label: 'Research', glyph: '∿' },
        { key: 'watchlist', label: 'Watchlist', glyph: '★' },
      ].map((t) => {
        const active = tab === t.key;
        return (
          <Pressable key={t.key} onPress={() => setTab(t.key)} style={s.tab}>
            <Text style={{ fontSize: 20, color: active ? colors.accent : colors.textFaint }}>{t.glyph}</Text>
            <Text style={[type.micro, { color: active ? colors.accent : colors.textFaint }]}>
              {t.label}
              {t.key === 'watchlist' && watchlist.length ? ` ${watchlist.length}` : ''}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );

  if (tab === 'research') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
        <StatusBar barStyle={scheme === 'dark' ? 'light-content' : 'dark-content'} />
        <View style={{ flex: 1 }}>
          <ResearchScreen research={research} />
        </View>
        {tabBar}
      </SafeAreaView>
    );
  }

  if (tab === 'market') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
        <StatusBar barStyle={scheme === 'dark' ? 'light-content' : 'dark-content'} />
        <MarketScreen
          data={data}
          research={research}
          win={win}
          setPreset={setPreset}
          setCustomWindow={setCustomWindow}
          metric={metric}
          setMetric={setMetric}
          skipEnabled={skipEnabled}
          setSkipEnabled={setSkipEnabled}
          sessionsStale={sessionsStale}
          isWatched={isWatched}
          toggleWatch={toggleWatch}
          onOpenDetail={pushTicker}
          onOrder={setOrder}
          overlap={overlap}
          overlapCaption={overlapCaption}
          tab={tabBar}
          familyCompare={familyCompare}
          familySlots={familySlots}
          toggleFamilyCompare={toggleFamilyCompare}
          onOpenFamily={pushFamily}
          groupCount={groupCount}
          setGroupCount={setGroupCount}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar barStyle={scheme === 'dark' ? 'light-content' : 'dark-content'} />
      <ListScreen
        title="Watchlist"
        universe={watched}
        dates={data.dates}
        sectors={data.sectors}
        win={win}
        setPreset={setPreset}
        setCustomWindow={setCustomWindow}
        metric={metric}
        setMetric={setMetric}
        skipEnabled={skipEnabled}
        setSkipEnabled={setSkipEnabled}
        sessionsStale={sessionsStale}
        isWatched={isWatched}
        toggleWatch={toggleWatch}
        onOpenDetail={pushTicker}
        onOrder={setOrder}
        tab={tabBar}
        overlap={overlap}
        emptyState={
          <View style={{ alignItems: 'center', gap: space(2) }}>
            <Text style={[type.title, { color: colors.text }]}>Nothing watched yet</Text>
            <Text style={[type.body, s.centreText, { color: colors.textMuted }]}>
              Tap any row on the Market tab to add it here. Press and hold a row to open its chart.
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <Shell />
    </ThemeProvider>
  );
}

const s = StyleSheet.create({
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space(3), padding: space(6) },
  centreText: { textAlign: 'center', maxWidth: 300 },
  retry: { paddingHorizontal: space(6), paddingVertical: space(3), borderRadius: radius.md },
  tabs: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: space(1.5) },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2, paddingVertical: space(1) },
});
