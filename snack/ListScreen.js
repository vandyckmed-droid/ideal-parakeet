import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { PortfolioSummary, ROW_HEIGHT, SegmentedControl, TickerRow } from './ui';
import { WindowPicker } from './WindowPicker';
import { useTheme, radius, space, type, mono } from './theme';
import { PRESETS, computeWindowStats, formatDateShort, metricValue, slice, withSkip } from './stats';
import { buildPortfolioTicker, computeDiversificationRatio } from './portfolio';

const METRICS = [
  { key: 'return', label: 'Return' },
  { key: 'ratio', label: 'Return ÷ σ' },
];

export function ListScreen({
  title, universe, dates, sectors, win, setPreset, setCustomWindow,
  metric, setMetric, skipEnabled, setSkipEnabled, sessionsStale,
  isWatched, toggleWatch, onOpenDetail, onOrder, emptyState, tab, overlap, overlapCaption,
  showPortfolioSummary,
}) {
  const { colors, scheme, preference, setPreference } = useTheme();
  // The range the maths actually uses, once the recent tail is dropped.
  const range = useMemo(
    () => withSkip(win, skipEnabled, sessionsStale, dates.length - 1),
    [win, skipEnabled, sessionsStale, dates.length]
  );

  // Skip applies here exactly as it does to every row below - this is a
  // return measurement, unlike Overlap, which deliberately ignores skip
  // because correlation structure isn't a return question.
  const showPortfolio = showPortfolioSummary && universe.length >= 2;
  const portfolioTicker = useMemo(
    () => (showPortfolio ? buildPortfolioTicker(universe, dates.length - 1) : null),
    [showPortfolio, universe, dates.length]
  );
  // applyFloor: false - see the comment on computeWindowStats in stats.js.
  const portfolioStats = useMemo(
    () =>
      portfolioTicker
        ? computeWindowStats(portfolioTicker, range.startIndex, range.endIndex, false)
        : null,
    [portfolioTicker, range]
  );
  const diversificationRatio = useMemo(
    () =>
      showPortfolio
        ? computeDiversificationRatio(
            universe,
            range.startIndex,
            range.endIndex,
            portfolioStats ? portfolioStats.annualizedVol : null
          )
        : null,
    [showPortfolio, universe, range, portfolioStats]
  );

  const [query, setQuery] = useState('');
  const [sector, setSector] = useState(null);
  const [sortKey, setSortKey] = useState('metric');
  const [descending, setDescending] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);

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
  }, [universe, query, sector, sortKey, descending, metric, range]);

  // Flagged names only: unflagged rows pass undefined, matching what TickerRow
  // already receives on the Market screen, so nothing else about a row
  // changes because this prop exists.
  const overlapScores = useMemo(() => {
    if (!overlap) return null;
    const m = new Map();
    for (const s of overlap.scores) {
      if (s.score !== null && overlap.flagged.has(s.symbol)) m.set(s.symbol, s.score);
    }
    return m;
  }, [overlap]);

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
      setDescending(key !== 'symbol');
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
        rank={sortKey === 'metric' ? index + 1 : undefined}
        overlapScore={overlapScores?.get(item.ticker.s)}
      />
    ),
    [metric, isWatched, toggleWatch, openDetail, sortKey, overlapScores]
  );

  const sortChips = [
    { key: 'metric', label: metric === 'return' ? 'Return' : 'Ratio' },
    { key: 'cap', label: 'Size' },
    { key: 'symbol', label: 'A–Z' },
  ];

  return (
    <View style={[s.root, { backgroundColor: colors.bg }]}>
      <View style={s.header}>
        <View style={s.headerTop}>
          <View>
            <Text style={[type.hero, { color: colors.text }]}>{title}</Text>
            <Text style={[type.caption, { color: colors.textMuted }]}>
              {rows.length} {rows.length === 1 ? 'name' : 'names'} · through{' '}
              {formatDateShort(dates[range.endIndex])}
              {range.skip > 0 ? ` · ${range.skip}d skipped` : ''}
            </Text>
            {overlapCaption && (
              <Text
                style={[
                  type.caption,
                  {
                    color: overlap && overlap.flagged.size > 0 ? colors.warn : colors.textFaint,
                    marginTop: 2,
                  },
                ]}
              >
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

        {showPortfolio && (
          <PortfolioSummary stats={portfolioStats} diversificationRatio={diversificationRatio} />
        )}

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
            <SegmentedControl segments={METRICS} value={metric} onChange={setMetric} />
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
          rows.length > 0 ? (
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
  header: { paddingHorizontal: space(4), paddingBottom: space(3), gap: space(2.5) },
  headerTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  themeButton: { width: 36, height: 36, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  search: { borderRadius: radius.md, paddingHorizontal: space(3.5), paddingVertical: space(2.75) },
  windowRow: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  customButton: { paddingHorizontal: space(3.5), paddingVertical: space(2), borderRadius: radius.md, borderWidth: 1 },
  chipRow: { gap: space(2), paddingRight: space(4), alignItems: 'center' },
  chip: { paddingHorizontal: space(3), paddingVertical: space(1.75), borderRadius: radius.pill, borderWidth: 1 },
  chipDivider: { width: StyleSheet.hairlineWidth, height: 20, marginHorizontal: space(1) },
  empty: { padding: space(10), alignItems: 'center' },
  hint: { textAlign: 'center', paddingVertical: space(5) },
});
