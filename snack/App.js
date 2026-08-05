// Parakeet - the 500 largest US-traded equities, with a selectable return
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
import { windowForPreset } from './stats';
import { ListScreen } from './ListScreen';
import { DetailScreen } from './DetailScreen';

const DATA_URL =
  'https://raw.githubusercontent.com/vandyckmed-droid/ideal-parakeet/main/assets/data/market.json';
const WATCHLIST_KEY = 'parakeet.watchlist';

function Shell() {
  const { colors, scheme } = useTheme();

  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);

  const [tab, setTab] = useState('market');
  const [detail, setDetail] = useState(null);
  const [order, setOrder] = useState([]);

  const [win, setWin] = useState(null);
  const [metric, setMetric] = useState('return');
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
        setWin(windowForPreset('1Y', json.dates));
      })
      .catch((e) => {
        if (!cancelled) setError(e.message || String(e));
      });
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
        <Text style={[type.caption, { color: colors.textMuted }]}>Loading 500 tickers…</Text>
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
          isWatched={isWatched}
          toggleWatch={toggleWatch}
          onBack={() => setDetail(null)}
        />
      </SafeAreaView>
    );
  }

  const watched = watchlist.map((sym) => data.bySymbol.get(sym)).filter(Boolean);

  const tabBar = (
    <View style={[s.tabs, { backgroundColor: colors.bg, borderTopColor: colors.hairline }]}>
      {[
        { key: 'market', label: 'Market', glyph: '◫' },
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

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar barStyle={scheme === 'dark' ? 'light-content' : 'dark-content'} />
      <ListScreen
        title={tab === 'market' ? 'Market' : 'Watchlist'}
        universe={tab === 'market' ? data.tickers : watched}
        dates={data.dates}
        sectors={data.sectors}
        win={win}
        setPreset={setPreset}
        setCustomWindow={setCustomWindow}
        metric={metric}
        setMetric={setMetric}
        isWatched={isWatched}
        toggleWatch={toggleWatch}
        onOpenDetail={setDetail}
        onOrder={setOrder}
        tab={tabBar}
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
