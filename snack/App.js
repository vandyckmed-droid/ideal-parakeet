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
import { sessionsSinceSnapshot, windowForPreset } from './stats';
import { computeOverlap, describeCandidateOverlap } from './overlap';
import { ListScreen } from './ListScreen';
import { ResearchScreen } from './Research';
import { RankTable } from './RankTable';
import { SegmentedControl } from './ui';
import { DetailScreen } from './DetailScreen';

const MARKET_VIEWS = [
  { key: 'card', label: 'Card' },
  { key: 'table', label: 'Table' },
];

const DATA_URL =
  'https://raw.githubusercontent.com/vandyckmed-droid/ideal-parakeet/main/assets/data/market.json';
// Main first; the working branch second so the tab works before the merge
// lands. Once research.json is on main the first URL always wins.
const RESEARCH_URLS = [
  'https://raw.githubusercontent.com/vandyckmed-droid/ideal-parakeet/main/assets/data/research.json',
  'https://raw.githubusercontent.com/vandyckmed-droid/ideal-parakeet/claude/stock-watchlist-app-ju7qxb/assets/data/research.json',
];
const WATCHLIST_KEY = 'parakeet.watchlist';
const SKIP_KEY = 'parakeet.skip';

function Shell() {
  const { colors, scheme } = useTheme();

  const [data, setData] = useState(null);
  const [research, setResearch] = useState(null);
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);

  const [tab, setTab] = useState('market');
  const [marketView, setMarketView] = useState('card');
  const [detail, setDetail] = useState(null);
  const [order, setOrder] = useState([]);

  const [win, setWin] = useState(null);
  const [metric, setMetric] = useState('return');
  const [skipEnabled, setSkipEnabledState] = useState(false);
  const [sessionsStale, setSessionsStale] = useState(0);
  const [watchlist, setWatchlist] = useState([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    fetch(DATA_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((json) => {
        if (cancelled) return;
        // Cache the last close per name so rows do not walk the array to find it.
        const tickers = json.tickers.map((t) => ({ ...t, last: t.p[t.p.length - 1] }));
        setData({
          dates: json.dates,
          tickers,
          bySymbol: new Map(tickers.map((t) => [t.s, t])),
          sectors: Array.from(new Set(tickers.map((t) => t.se))).sort(),
          generatedAt: json.generatedAt,
        });
        // Read once per load: window maths must not depend on wall-clock time.
        setSessionsStale(sessionsSinceSnapshot(json.dates));
        setWin(windowForPreset('1Y', json.dates));
      })
      .catch((e) => {
        if (!cancelled) setError(e.message || String(e));
      });
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
  }, []);

  const setSkipEnabled = useCallback((v) => {
    setSkipEnabledState(v);
    AsyncStorage.setItem(SKIP_KEY, v ? '1' : '0').catch(() => {});
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

  if (detail) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
        <StatusBar barStyle={scheme === 'dark' ? 'light-content' : 'dark-content'} />
        <DetailScreen
          symbols={order.length ? order : data.tickers.map((t) => t.s)}
          bySymbol={data.bySymbol}
          dates={data.dates}
          initialSymbol={detail}
          preset={win.preset}
          skipEnabled={skipEnabled}
          sessionsStale={sessionsStale}
          isWatched={isWatched}
          toggleWatch={toggleWatch}
          onBack={() => setDetail(null)}
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

  // The Market tab in two views of the same 500 names. Local state rather than
  // persisted: the choice survives switching tabs, which is the only continuity
  // that matters here - a view mode restored on a cold start would be a
  // setting, and this is a glance.
  const viewSwitch =
    tab === 'market' ? (
      <SegmentedControl segments={MARKET_VIEWS} value={marketView} onChange={setMarketView} />
    ) : null;

  if (tab === 'market' && marketView === 'table') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
        <StatusBar barStyle={scheme === 'dark' ? 'light-content' : 'dark-content'} />
        <RankTable
          universe={data.tickers}
          dates={data.dates}
          sectors={data.sectors}
          metric={metric}
          setMetric={setMetric}
          skipEnabled={skipEnabled}
          setSkipEnabled={setSkipEnabled}
          sessionsStale={sessionsStale}
          isWatched={isWatched}
          toggleWatch={toggleWatch}
          onOpenDetail={setDetail}
          tab={tabBar}
          headerAccessory={viewSwitch}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar barStyle={scheme === 'dark' ? 'light-content' : 'dark-content'} />
      <ListScreen
        headerAccessory={viewSwitch}
        title={tab === 'market' ? 'Market' : 'Watchlist'}
        universe={tab === 'market' ? data.tickers : watched}
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
        onOpenDetail={setDetail}
        onOrder={setOrder}
        tab={tabBar}
        overlap={overlap}
        overlapCaption={overlapCaption}
        showCaption={tab === 'market'}
        showGestureHint={tab === 'market'}
        emptyState={
          tab === 'watchlist' ? (
            <View style={{ alignItems: 'center', gap: space(2) }}>
              <Text style={[type.title, { color: colors.text }]}>Nothing watched yet</Text>
              <Text style={[type.body, s.centreText, { color: colors.textMuted }]}>
                Tap any row on the Market tab to add it here. Press and hold a row to open its chart.
              </Text>
            </View>
          ) : (
            <Text style={[type.body, { color: colors.textMuted }]}>Nothing matches those filters.</Text>
          )
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
