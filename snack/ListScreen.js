import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { ROW_HEIGHT, SegmentedControl, TickerRow } from './ui';
import { WindowPicker } from './WindowPicker';
import { useTheme, radius, space, type, mono } from './theme';
import { PRESETS, computeWindowStats, formatDateShort, metricValue, slice, withSkip } from './stats';

const METRICS = [
  { key: 'return', label: 'Return' },
  { key: 'ratio', label: 'Return ÷ σ' },
  { key: 'residual', label: 'Residual' },
];

export function ListScreen({
  title, universe, dates, sectors, win, setPreset, setCustomWindow,
  metric, setMetric, skipEnabled, setSkipEnabled, sessionsStale,
  isWatched, toggleWatch, onOpenDetail, onOrder, emptyState, tab, overlap, overlapCaption,
  showCaption,
  // The "tap a row to watchlist it" footer. True only where a tap actually
  // *adds*: on the Watchlist screen a tap removes the row it lands on, so the
  // same sentence there describes the opposite of what the gesture does.
  showGestureHint,
  // Rendered between the title block and the search box. Exists for the Market
  // tab's Card/Table switch, which sits inside this header but belongs to the
  // screen above it.
  headerAccessory,
}) {
  const { colors, scheme, preference, setPreference } = useTheme();
  // The range the maths actually uses, once the recent tail is dropped.
  const range = useMemo(
    () => withSkip(win, skipEnabled, sessionsStale, dates.length - 1),
    [win, skipEnabled, sessionsStale, dates.length]
  );

  const [query, setQuery] = useState('');
  const [sector, setSector] = useState(null);
  const [sortKey, setSortKey] = useState('metric');
  const [descending, setDescending] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);

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
    const needle = query.trim().toUpperCase();
    const built = universe
      .filter((t) => (sector ? t.se === sector : true))
      .filter((t) => (needle ? t.s.includes(needle) || t.n.toUpperCase().includes(needle) : true))
      .map((t) => ({
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

  const cycleSort = (key) => {
    if (sortKey === key) setDescending((d) => !d);
    else {
      setSortKey(key);
      // Overlap's useful direction is ascending, same as Symbol: lowest
      // correlation to the rest of the list first, so the top of the list is
      // whichever name would add the most diversification.
      setDescending(key !== 'symbol' && key !== 'overlap');
    }
  };

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

  // Only offered once the basket itself qualifies for a score: with too few
  // names or too short a window every score is null, and a sort with nothing
  // to rank by is a control that does nothing.
  const sortChips = [
    // The chip names whatever the metric control is set to, so the sort and
    // its label can never describe different columns.
    {
      key: 'metric',
      label: metric === 'return' ? 'Return' : metric === 'residual' ? 'Residual' : 'Ratio',
    },
    { key: 'cap', label: 'Size' },
    { key: 'symbol', label: 'A–Z' },
    ...(overlap && overlap.reason === 'ok' ? [{ key: 'overlap', label: 'Overlap' }] : []),
  ];

  return (
    <View style={[s.root, { backgroundColor: colors.bg }]}>
      <View style={s.header}>
        <View style={s.headerTop}>
          <View>
            <Text style={[type.hero, { color: colors.text }]}>{title}</Text>
            {showCaption && (
              <Text style={[type.caption, { color: colors.textMuted }]}>
                {rows.length} {rows.length === 1 ? 'name' : 'names'} · through{' '}
                {formatDateShort(dates[range.endIndex])}
                {range.skip > 0 ? ` · ${range.skip}d skipped` : ''}
              </Text>
            )}
            {/* Always the faint tone. Every caption either screen still
                produces is a precondition the user can act on, never a
                finding - findings live on the rows they belong to. */}
            {overlapCaption && (
              <Text style={[type.caption, { color: colors.textFaint, marginTop: 2 }]}>
                {overlapCaption}
              </Text>
            )}
          </View>
          <Pressable
            onPress={() =>
              setPreference(preference === 'system' ? (scheme === 'dark' ? 'light' : 'dark') : 'system')
            }
            style={[s.themeButton, { backgroundColor: colors.surface }]}
            accessibilityRole="button"
            accessibilityLabel={`Theme: ${preference}`}
          >
            <Text style={{ fontSize: 16 }}>
              {preference === 'system' ? '◐' : scheme === 'dark' ? '☾' : '☀'}
            </Text>
          </Pressable>
        </View>

        {/* Search and the view switch share a row: both are "what am I looking
            at" controls, and stacking them cost a full row of chrome before
            the first piece of data. */}
        <View style={s.searchRow}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search symbol or company"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="characters"
            autoCorrect={false}
            clearButtonMode="while-editing"
            style={[s.search, type.body, { backgroundColor: colors.surface, color: colors.text }]}
          />
          {headerAccessory ? <View style={s.accessory}>{headerAccessory}</View> : null}
        </View>

        <View style={s.windowRow}>
          <View style={{ flex: 1 }}>
            <SegmentedControl segments={PRESETS} value={win.preset} onChange={setPreset} compact />
          </View>
          <Pressable
            onPress={() => setPickerOpen(true)}
            style={[
              s.customButton,
              {
                backgroundColor: win.preset === 'CUSTOM' ? colors.accentMuted : colors.surface,
                borderColor: win.preset === 'CUSTOM' ? colors.accent : 'transparent',
              },
            ]}
          >
            <Text style={[type.caption, { color: win.preset === 'CUSTOM' ? colors.accent : colors.textMuted }]}>
              Custom
            </Text>
          </Pressable>
        </View>

        <View style={s.windowRow}>
          <View style={{ flex: 1 }}>
            <SegmentedControl segments={METRICS} value={metric} onChange={setMetric} compact />
          </View>
          <Pressable
            onPress={() => setSkipEnabled(!skipEnabled)}
            style={[
              s.customButton,
              {
                backgroundColor: skipEnabled ? colors.accentMuted : colors.surface,
                borderColor: skipEnabled ? colors.accent : 'transparent',
              },
            ]}
            accessibilityRole="switch"
            accessibilityState={{ checked: skipEnabled }}
            accessibilityLabel={
              skipEnabled
                ? `Skipping the last ${range.skip} trading days`
                : 'Include the most recent trading days'
            }
          >
            <Text style={[type.caption, { color: skipEnabled ? colors.accent : colors.textMuted }]}>
              {skipEnabled ? `Skip ${range.skip}d` : 'Skip'}
            </Text>
          </Pressable>
        </View>

        {(win.preset === 'CUSTOM' || range.skip > 0) && (
          <Text style={[type.caption, mono, { color: colors.textMuted }]}>
            {dates[range.startIndex]} → {dates[range.endIndex]}
            {range.shortfall > 0
              ? `  ·  ${range.shortfall}d short`
              : sessionsStale > 0 && range.skip > 0
                ? `  ·  data ${sessionsStale}d behind`
                : ''}
          </Text>
        )}

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipRow}>
          {sortChips.map((chip) => {
            const active = sortKey === chip.key;
            return (
              <Pressable
                key={chip.key}
                onPress={() => cycleSort(chip.key)}
                style={[
                  s.chip,
                  {
                    backgroundColor: active ? colors.accentMuted : colors.surface,
                    borderColor: active ? colors.accent : 'transparent',
                  },
                ]}
              >
                <Text style={[type.caption, { color: active ? colors.accent : colors.textMuted }]}>
                  {chip.label}
                  {active ? (descending ? ' ↓' : ' ↑') : ''}
                </Text>
              </Pressable>
            );
          })}
          <View style={[s.chipDivider, { backgroundColor: colors.border }]} />
          {[null].concat(sectors).map((sec) => {
            const active = sector === sec;
            return (
              <Pressable
                key={sec || 'all'}
                onPress={() => setSector(sec)}
                style={[
                  s.chip,
                  {
                    backgroundColor: active ? colors.accentMuted : colors.surface,
                    borderColor: active ? colors.accent : 'transparent',
                  },
                ]}
              >
                <Text style={[type.caption, { color: active ? colors.accent : colors.textMuted }]}>
                  {sec || 'All sectors'}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

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
        ListEmptyComponent={<View style={s.empty}>{emptyState || null}</View>}
        ListFooterComponent={
          showGestureHint && rows.length > 0 ? (
            <Text style={[type.caption, s.hint, { color: colors.textFaint }]}>
              Tap a row to watchlist it · press and hold to open it
            </Text>
          ) : null
        }
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
  header: { paddingHorizontal: space(4), paddingBottom: space(2.5), gap: space(2) },
  headerTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  themeButton: { width: 36, height: 36, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  searchRow: { flexDirection: 'row', alignItems: 'stretch', gap: space(2) },
  // minWidth 0: otherwise the placeholder's width is the field's minimum and
  // the view switch gets shoved off the right edge.
  search: { flex: 1, minWidth: 0, borderRadius: radius.md, paddingHorizontal: space(3.5), paddingVertical: space(2.75) },
  accessory: { width: 148, justifyContent: 'center' },
  windowRow: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  customButton: { paddingHorizontal: space(3.5), paddingVertical: space(2), borderRadius: radius.md, borderWidth: 1 },
  chipRow: { gap: space(2), paddingRight: space(4), alignItems: 'center' },
  chip: { paddingHorizontal: space(3), paddingVertical: space(1.75), borderRadius: radius.pill, borderWidth: 1 },
  chipDivider: { width: StyleSheet.hairlineWidth, height: 20, marginHorizontal: space(1) },
  empty: { padding: space(10), alignItems: 'center' },
  hint: { textAlign: 'center', paddingVertical: space(5) },
});
