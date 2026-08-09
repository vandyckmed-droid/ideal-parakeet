// Mirrors src/components/StockListBody.tsx and src/screens/TickerListScreen.tsx
// - if these ever disagree, the .tsx files are the ones that are wrong.

import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';

import { ROW_HEIGHT, TickerRow } from './ui';
import { ListHeader } from './chrome';
import { WindowPicker } from './WindowPicker';
import { useTheme, space, type } from './theme';
import { computeWindowStats, metricValue, slice, withSkip } from './stats';

/** The one filter predicate, shared with the header's live row count. */
export function filterUniverse(universe, query, sector) {
  const needle = query.trim().toUpperCase();
  return universe
    .filter((t) => (sector ? t.se === sector : true))
    .filter((t) => (needle ? t.s.includes(needle) || t.n.toUpperCase().includes(needle) : true));
}

/**
 * The scored, sorted stock list - the body below the shared header, used by
 * the Market tab's card view and by the Watchlist. All filter and sort state
 * lives with the caller so it can drive the header's chips and captions and
 * survive view switches; this component just renders what that state says.
 */
export function StockListBody({
  universe, dates, win, metric, skipEnabled, sessionsStale,
  query, sector, sortKey, descending,
  overlap, overlapCaption, emptyState, showGestureHint,
  isWatched, toggleWatch, onOpenDetail, onOrder,
}) {
  const { colors } = useTheme();

  const range = useMemo(
    () => withSkip(win, skipEnabled, sessionsStale, dates.length - 1),
    [win, skipEnabled, sessionsStale, dates.length]
  );

  // Every scored name, keyed by symbol. Sorting by Overlap needs every row's
  // own number to rank against, not just the ones that clear the flag
  // threshold - while that sort is active this widens from "flagged only" to
  // "every non-null score," and TickerRow shows the distinction with colour
  // instead of only rendering a badge for some rows.
  const overlapScores = useMemo(() => {
    if (!overlap) return null;
    const m = new Map();
    for (const s of overlap.scores) {
      if (s.score === null) continue;
      if (sortKey === 'overlap' || overlap.flagged.has(s.symbol)) m.set(s.symbol, s.score);
    }
    return m;
  }, [overlap, sortKey]);

  const rows = useMemo(() => {
    const built = filterUniverse(universe, query, sector).map((t) => ({
      ticker: t,
      stats: computeWindowStats(t, range.startIndex, range.endIndex),
      // Sparkline ends where the measurement ends, so the shape and the
      // number beside it describe the same stretch of time.
      series: slice(t, range.startIndex, range.endIndex),
    }));

    const dir = descending ? -1 : 1;
    built.sort((a, b) => {
      if (sortKey === 'symbol') return a.ticker.s.localeCompare(b.ticker.s) * dir;
      if (sortKey === 'cap') return (a.ticker.mc - b.ticker.mc) * dir;
      if (sortKey === 'overlap') {
        const av = overlapScores ? overlapScores.get(a.ticker.s) ?? null : null;
        const bv = overlapScores ? overlapScores.get(b.ticker.s) ?? null : null;
        if (av === null && bv === null) return 0;
        if (av === null) return 1;
        if (bv === null) return -1;
        return (av - bv) * dir;
      }
      const av = metricValue(a.stats, metric);
      const bv = metricValue(b.stats, metric);
      // Names with no history in the window sort to the bottom either way,
      // rather than masquerading as the worst performers.
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return (av - bv) * dir;
    });
    return built;
  }, [universe, query, sector, sortKey, descending, metric, range, overlapScores]);

  // Publish the visible order so the detail view swipes through the same list.
  const symbols = useMemo(() => rows.map((r) => r.ticker.s), [rows]);

  const openDetail = useCallback(
    (sym) => {
      onOrder(symbols);
      onOpenDetail(sym);
    },
    [symbols, onOrder, onOpenDetail]
  );

  const renderItem = useCallback(
    ({ item, index }) => (
      <TickerRow
        ticker={item.ticker}
        stats={item.stats}
        series={item.series}
        metric={metric}
        watched={isWatched(item.ticker.s)}
        onToggleWatch={toggleWatch}
        onOpenDetail={openDetail}
        rank={sortKey === 'metric' || sortKey === 'overlap' ? index + 1 : undefined}
        overlapScore={overlapScores?.get(item.ticker.s)}
      />
    ),
    [metric, isWatched, toggleWatch, openDetail, sortKey, overlapScores]
  );

  return (
    <FlatList
      data={rows}
      keyExtractor={(r) => r.ticker.s}
      renderItem={renderItem}
      getItemLayout={(_, index) => ({ length: ROW_HEIGHT, offset: ROW_HEIGHT * index, index })}
      initialNumToRender={12}
      maxToRenderPerBatch={10}
      windowSize={9}
      removeClippedSubviews
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        overlapCaption ? (
          <Text style={[type.caption, s.overlapNote, { color: colors.textFaint }]}>
            {overlapCaption}
          </Text>
        ) : null
      }
      ListEmptyComponent={
        <View style={s.empty}>
          {emptyState || (
            <Text style={[type.body, { color: colors.textMuted }]}>
              Nothing matches those filters.
            </Text>
          )}
        </View>
      }
      ListFooterComponent={
        showGestureHint && rows.length > 0 ? (
          <Text style={[type.caption, s.hint, { color: colors.textFaint }]}>
            Tap a row to watchlist it · press and hold to open it
          </Text>
        ) : null
      }
    />
  );
}

/**
 * A stock list under the standard header - today that means the Watchlist.
 * The Market tab composes the same ListHeader and StockListBody itself (it
 * has three bodies to swap under one header); this screen is the
 * single-body case.
 *
 * No caption between the title and the search box, deliberately: the numbers
 * that belong to a name belong on that name's row.
 */
export function ListScreen({
  title, universe, dates, sectors, win, setPreset, setCustomWindow,
  metric, setMetric, skipEnabled, setSkipEnabled, sessionsStale,
  isWatched, toggleWatch, onOpenDetail, onOrder, emptyState, tab, overlap,
}) {
  const [query, setQuery] = useState('');
  const [sector, setSector] = useState(null);
  const [sortKey, setSortKey] = useState('metric');
  const [descending, setDescending] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const { colors } = useTheme();

  const range = useMemo(
    () => withSkip(win, skipEnabled, sessionsStale, dates.length - 1),
    [win, skipEnabled, sessionsStale, dates.length]
  );

  const chipGroups = useMemo(() => {
    const cycle = (key) => {
      if (sortKey === key) setDescending((d) => !d);
      else {
        setSortKey(key);
        // Overlap's useful direction is ascending, same as Symbol: lowest
        // correlation to the rest of the list first, so the top of the list
        // is whichever name would add the most diversification.
        setDescending(key !== 'symbol' && key !== 'overlap');
      }
    };
    const arrow = (active) => (active ? (descending ? ' ↓' : ' ↑') : '');
    const metricLabel =
      metric === 'return' ? 'Return' : metric === 'residual' ? 'Residual' : 'Ratio';
    const sortChips = [
      { key: 'metric', label: `${metricLabel}${arrow(sortKey === 'metric')}` },
      { key: 'cap', label: `Size${arrow(sortKey === 'cap')}` },
      { key: 'symbol', label: `A–Z${arrow(sortKey === 'symbol')}` },
      ...(overlap && overlap.reason === 'ok'
        ? [{ key: 'overlap', label: `Overlap${arrow(sortKey === 'overlap')}` }]
        : []),
    ].map((c) => ({ ...c, active: sortKey === c.key, onPress: () => cycle(c.key) }));
    const sectorChips = [null].concat(sectors).map((sec) => ({
      key: sec || 'all',
      label: sec || 'All sectors',
      active: sector === sec,
      onPress: () => setSector(sec),
    }));
    return [sortChips, sectorChips];
  }, [sortKey, descending, metric, overlap, sector, sectors]);

  return (
    <View style={[s.root, { backgroundColor: colors.bg }]}>
      <ListHeader
        title={title}
        query={query}
        onQuery={setQuery}
        win={win}
        onPreset={setPreset}
        onOpenPicker={() => setPickerOpen(true)}
        metric={metric}
        onMetric={setMetric}
        skipEnabled={skipEnabled}
        onToggleSkip={() => setSkipEnabled(!skipEnabled)}
        range={range}
        sessionsStale={sessionsStale}
        dates={dates}
        chipGroups={chipGroups}
      />

      <StockListBody
        universe={universe}
        dates={dates}
        win={win}
        metric={metric}
        skipEnabled={skipEnabled}
        sessionsStale={sessionsStale}
        query={query}
        sector={sector}
        sortKey={sortKey}
        descending={descending}
        overlap={overlap}
        emptyState={emptyState}
        isWatched={isWatched}
        toggleWatch={toggleWatch}
        onOpenDetail={onOpenDetail}
        onOrder={onOrder}
      />

      {tab}

      <WindowPicker
        visible={pickerOpen}
        window={win}
        dates={dates}
        onClose={() => setPickerOpen(false)}
        onApply={setCustomWindow}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  overlapNote: { paddingHorizontal: space(4), paddingBottom: space(2) },
  empty: { padding: space(10), alignItems: 'center' },
  hint: { textAlign: 'center', paddingVertical: space(5) },
});
