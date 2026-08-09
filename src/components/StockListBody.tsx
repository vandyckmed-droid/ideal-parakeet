import { useIsFocused, useRouter } from 'expo-router';
import React, { useCallback, useDeferredValue, useEffect, useMemo } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ROW_HEIGHT, TickerRow } from './TickerRow';
import { Ticker, slice } from '../data/market';
import { OverlapSummary } from '../data/overlap';
import { computeWindowStats, metricValue } from '../data/stats';
import { withSkip } from '../data/windows';
import { useAppState } from '../state/AppState';
import { setOrderedSymbols } from '../state/listContext';
import { useColors } from '../theme/ThemeProvider';
import { space, type } from '../theme/theme';

/** The one filter predicate, shared with the header's live row count. */
export function filterUniverse(universe: Ticker[], query: string, sector: string | null): Ticker[] {
  const needle = query.trim().toUpperCase();
  return universe
    .filter((t) => (sector ? t.sector === sector : true))
    .filter((t) =>
      needle ? t.symbol.includes(needle) || t.name.toUpperCase().includes(needle) : true
    );
}

/**
 * The scored stock list - the body below the shared header, used by the
 * Market tab's card view and by the Watchlist. Always ranked by the selected
 * metric, best first: the metric control above IS the sort, so the rank
 * numeral, the value column and the order can never describe different
 * things. Filter state lives with the caller so it can drive the header's
 * chips and captions and survive view switches.
 */
export function StockListBody({
  universe,
  query,
  sector,
  overlap,
  overlapCaption,
  emptyState,
  showGestureHint,
}: {
  universe: Ticker[];
  query: string;
  sector: string | null;
  overlap?: OverlapSummary;
  /**
   * A precondition the user can act on, never a finding - findings live on
   * the rows they belong to. Rides at the top of the list rather than in the
   * header so the chrome above never changes height.
   */
  overlapCaption?: string | null;
  emptyState?: React.ReactNode;
  showGestureHint?: boolean;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const {
    window: win, metric, skipEnabled, sessionsStale, isWatched, toggleWatch,
  } = useAppState();

  const range = useMemo(
    () => withSkip(win, skipEnabled, sessionsStale),
    [win, skipEnabled, sessionsStale]
  );

  // Typing should not block on re-ranking 500 rows on every keystroke.
  const deferredQuery = useDeferredValue(query);

  // Flagged names only: the badge warns about redundancy against the
  // watchlist, and TickerRow renders it for exactly the rows in this map.
  const overlapScores = useMemo(() => {
    if (!overlap) return null;
    const m = new Map<string, number>();
    for (const s of overlap.scores) {
      if (s.score !== null && overlap.flagged.has(s.symbol)) m.set(s.symbol, s.score);
    }
    return m;
  }, [overlap]);

  const rows = useMemo(() => {
    const built = filterUniverse(universe, deferredQuery, sector).map((t) => ({
      ticker: t,
      stats: computeWindowStats(t, range.startIndex, range.endIndex),
      // Sparkline ends where the measurement ends, so the shape and the
      // number next to it always describe the same stretch of time.
      series: slice(t, range.startIndex, range.endIndex),
    }));

    built.sort((a, b) => {
      const av = metricValue(a.stats, metric);
      const bv = metricValue(b.stats, metric);
      // Names with no history in the window sort to the bottom either way,
      // rather than masquerading as the worst performers.
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return bv - av;
    });

    return built;
  }, [universe, deferredQuery, sector, metric, range]);

  // Publish the visible order so the detail view swipes through the same list.
  // Gated on focus: both tabs stay mounted, and without the gate the
  // Watchlist's handful of names would overwrite the Market tab's 500.
  const symbols = useMemo(() => rows.map((r) => r.ticker.symbol), [rows]);
  const isFocused = useIsFocused();
  useEffect(() => {
    if (isFocused) setOrderedSymbols(symbols);
  }, [symbols, isFocused]);

  const openDetail = useCallback(
    (symbol: string) => router.push(`/ticker/${symbol}`),
    [router]
  );

  const renderItem = useCallback(
    ({ item, index }: { item: (typeof rows)[number]; index: number }) => (
      <TickerRow
        ticker={item.ticker}
        stats={item.stats}
        series={item.series}
        metric={metric}
        watched={isWatched(item.ticker.symbol)}
        onToggleWatch={toggleWatch}
        onOpenDetail={openDetail}
        rank={index + 1}
        overlapScore={overlapScores?.get(item.ticker.symbol)}
      />
    ),
    [metric, isWatched, toggleWatch, openDetail, overlapScores]
  );

  return (
    <FlatList
      data={rows}
      keyExtractor={(r) => r.ticker.symbol}
      renderItem={renderItem}
      getItemLayout={(_, index) => ({
        length: ROW_HEIGHT,
        offset: ROW_HEIGHT * index,
        index,
      })}
      initialNumToRender={14}
      maxToRenderPerBatch={12}
      windowSize={9}
      removeClippedSubviews
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingBottom: insets.bottom + space(6) }}
      ListHeaderComponent={
        overlapCaption ? (
          <Text style={[type.caption, styles.overlapNote, { color: colors.textFaint }]}>
            {overlapCaption}
          </Text>
        ) : null
      }
      ListEmptyComponent={
        <View style={styles.empty}>
          {emptyState ?? (
            <Text style={[type.body, { color: colors.textMuted }]}>
              Nothing matches those filters.
            </Text>
          )}
        </View>
      }
      ListFooterComponent={
        showGestureHint && rows.length > 0 ? (
          <Text style={[type.caption, styles.hint, { color: colors.textFaint }]}>
            Tap a row to watchlist it · press and hold to open it
          </Text>
        ) : null
      }
    />
  );
}

const styles = StyleSheet.create({
  overlapNote: { paddingHorizontal: space(4), paddingBottom: space(2) },
  empty: { padding: space(10), alignItems: 'center' },
  hint: { textAlign: 'center', paddingVertical: space(5) },
});
