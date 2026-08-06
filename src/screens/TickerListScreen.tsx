import { useIsFocused, useRouter } from 'expo-router';
import React, {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PortfolioSummary } from '../components/PortfolioSummary';
import { ROW_HEIGHT, TickerRow } from '../components/TickerRow';
import { SegmentedControl } from '../components/SegmentedControl';
import { WindowPicker } from '../components/WindowPicker';
import { DATES, SECTORS, Ticker, formatDateShort, slice } from '../data/market';
import { OverlapSummary } from '../data/overlap';
import { buildPortfolioTicker } from '../data/portfolio';
import { MetricKey, computeWindowStats, metricValue } from '../data/stats';
import { PRESETS, PresetKey, withSkip } from '../data/windows';
import { useAppState } from '../state/AppState';
import { setOrderedSymbols } from '../state/listContext';
import { useTheme } from '../theme/ThemeProvider';
import { mono, radius, space, type } from '../theme/theme';

type SortKey = 'metric' | 'cap' | 'symbol';

const METRIC_SEGMENTS: { key: MetricKey; label: string }[] = [
  { key: 'return', label: 'Return' },
  { key: 'ratio', label: 'Return ÷ σ' },
];

export function TickerListScreen({
  title,
  universe,
  emptyState,
  overlap,
  overlapCaption,
  showPortfolioSummary,
}: {
  title: string;
  universe: Ticker[];
  emptyState?: React.ReactNode;
  /**
   * Drives the row badges on any screen that supplies it. The Market screen
   * scores the full universe against the current watchlist; the Watchlist
   * screen scores just its own members.
   */
  overlap?: OverlapSummary;
  /**
   * Header line under the title, or omit for none. What it should say differs
   * by screen (a Watchlist screen names its own redundant holdings; a Market
   * screen counts candidates that would be redundant if added), so the caller
   * computes the text rather than this component guessing which case applies.
   */
  overlapCaption?: string | null;
  /**
   * Shows `universe` treated as one equal-weighted position, using whatever
   * window and skip setting the rest of the screen is using. Only meaningful
   * when `universe` genuinely is "the portfolio" - the Watchlist screen's own
   * holdings, not the Market screen's full 500.
   */
  showPortfolioSummary?: boolean;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, scheme, preference, setPreference } = useTheme();
  const {
    window: win, setPreset, setCustomWindow, metric, setMetric,
    skipEnabled, setSkipEnabled, sessionsStale, isWatched, toggleWatch,
  } = useAppState();

  // The range the maths actually uses: recent tail dropped, and anchored to
  // today rather than to whenever the snapshot was taken.
  const range = useMemo(
    () => withSkip(win, skipEnabled, sessionsStale),
    [win, skipEnabled, sessionsStale]
  );

  // Skip applies here exactly as it does to every row below: this is a
  // return measurement, and the whole point of skip is excluding short-term
  // reversal from a return measurement. That is the opposite of Overlap's
  // window choice, which deliberately ignores skip because correlation
  // structure isn't a return question.
  const showPortfolio = showPortfolioSummary && universe.length >= 2;
  const portfolioTicker = useMemo(
    () => (showPortfolio ? buildPortfolioTicker(universe) : null),
    [showPortfolio, universe]
  );
  const portfolioStats = useMemo(
    () =>
      portfolioTicker ? computeWindowStats(portfolioTicker, range.startIndex, range.endIndex) : null,
    [portfolioTicker, range]
  );

  const [query, setQuery] = useState('');
  const [sector, setSector] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('metric');
  const [descending, setDescending] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Typing should not block on re-ranking 500 rows on every keystroke.
  const deferredQuery = useDeferredValue(query);

  const rows = useMemo(() => {
    const needle = deferredQuery.trim().toUpperCase();

    const built = universe
      .filter((t) => (sector ? t.sector === sector : true))
      .filter((t) =>
        needle
          ? t.symbol.includes(needle) || t.name.toUpperCase().includes(needle)
          : true
      )
      .map((t) => ({
        ticker: t,
        stats: computeWindowStats(t, range.startIndex, range.endIndex),
        // Sparkline ends where the measurement ends, so the shape and the
        // number next to it always describe the same stretch of time.
        series: slice(t, range.startIndex, range.endIndex),
      }));

    const dir = descending ? -1 : 1;
    built.sort((a, b) => {
      if (sortKey === 'symbol') {
        return a.ticker.symbol.localeCompare(b.ticker.symbol) * dir;
      }
      if (sortKey === 'cap') {
        return (a.ticker.marketCap - b.ticker.marketCap) * dir;
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
  }, [universe, deferredQuery, sector, sortKey, descending, metric, range]);

  // Flagged names only: unflagged rows pass `undefined`, which is the same
  // value TickerRow already receives on the Market screen, so nothing else
  // about a row's rendering changes because this prop exists.
  const overlapScores = useMemo(() => {
    if (!overlap) return null;
    const m = new Map<string, number>();
    for (const s of overlap.scores) {
      if (s.score !== null && overlap.flagged.has(s.symbol)) m.set(s.symbol, s.score);
    }
    return m;
  }, [overlap]);

  // Publish the visible order so the detail view swipes through the same list.
  // Both tabs stay mounted, so this is gated on focus: without that the
  // Watchlist's handful of names would overwrite the Market tab's 500 and a
  // detail view opened from Market would only swipe through the watchlist.
  const symbols = useMemo(() => rows.map((r) => r.ticker.symbol), [rows]);
  const isFocused = useIsFocused();
  useEffect(() => {
    if (isFocused) setOrderedSymbols(symbols);
  }, [symbols, isFocused]);

  const openDetail = useCallback(
    (symbol: string) => router.push(`/ticker/${symbol}`),
    [router]
  );

  const cycleSort = useCallback((key: SortKey) => {
    setSortKey((prev) => {
      if (prev === key) {
        setDescending((d) => !d);
        return prev;
      }
      setDescending(key !== 'symbol');
      return key;
    });
  }, []);

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
        rank={sortKey === 'metric' ? index + 1 : undefined}
        overlapScore={overlapScores?.get(item.ticker.symbol)}
      />
    ),
    [metric, isWatched, toggleWatch, openDetail, sortKey, overlapScores]
  );

  const sortChips: { key: SortKey; label: string }[] = [
    { key: 'metric', label: metric === 'return' ? 'Return' : 'Ratio' },
    { key: 'cap', label: 'Size' },
    { key: 'symbol', label: 'A–Z' },
  ];

  return (
    <View style={[styles.root, { backgroundColor: colors.bg, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View>
            <Text style={[type.hero, { color: colors.text }]}>{title}</Text>
            <Text style={[type.caption, { color: colors.textMuted }]}>
              {rows.length} {rows.length === 1 ? 'name' : 'names'} · through{' '}
              {formatDateShort(DATES[range.endIndex])}
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
              setPreference(
                preference === 'system' ? (scheme === 'dark' ? 'light' : 'dark') : 'system'
              )
            }
            style={[styles.themeButton, { backgroundColor: colors.surface }]}
            accessibilityRole="button"
            accessibilityLabel={`Theme: ${preference}`}
          >
            <Text style={{ fontSize: 16 }}>
              {preference === 'system' ? '◐' : scheme === 'dark' ? '☾' : '☀'}
            </Text>
          </Pressable>
        </View>

        {showPortfolio && <PortfolioSummary stats={portfolioStats} />}

        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search symbol or company"
          placeholderTextColor={colors.textFaint}
          autoCapitalize="characters"
          autoCorrect={false}
          clearButtonMode="while-editing"
          style={[
            styles.search,
            type.body,
            { backgroundColor: colors.surface, color: colors.text },
          ]}
        />

        <View style={styles.windowRow}>
          <View style={{ flex: 1 }}>
            <SegmentedControl<PresetKey>
              segments={PRESETS}
              value={win.preset}
              onChange={setPreset}
              compact
            />
          </View>
          <Pressable
            onPress={() => setPickerOpen(true)}
            style={[
              styles.customButton,
              {
                backgroundColor: win.preset === 'CUSTOM' ? colors.accentMuted : colors.surface,
                borderColor: win.preset === 'CUSTOM' ? colors.accent : 'transparent',
              },
            ]}
          >
            <Text
              style={[
                type.caption,
                { color: win.preset === 'CUSTOM' ? colors.accent : colors.textMuted },
              ]}
            >
              Custom
            </Text>
          </Pressable>
        </View>

        <View style={styles.windowRow}>
          <View style={{ flex: 1 }}>
            <SegmentedControl<MetricKey>
              segments={METRIC_SEGMENTS}
              value={metric}
              onChange={setMetric}
            />
          </View>
          <Pressable
            onPress={() => setSkipEnabled(!skipEnabled)}
            style={[
              styles.customButton,
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
            <Text
              style={[
                type.caption,
                { color: skipEnabled ? colors.accent : colors.textMuted },
              ]}
            >
              {skipEnabled ? `Skip ${range.skip}d` : 'Skip'}
            </Text>
          </Pressable>
        </View>

        {(win.preset === 'CUSTOM' || range.skip > 0) && (
          <Text style={[type.caption, mono, { color: colors.textMuted }]}>
            {DATES[range.startIndex]} → {DATES[range.endIndex]}
            {range.shortfall > 0
              ? `  ·  ${range.shortfall}d short`
              : sessionsStale > 0 && range.skip > 0
                ? `  ·  data ${sessionsStale}d behind`
                : ''}
          </Text>
        )}

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {sortChips.map((chip) => {
            const active = sortKey === chip.key;
            return (
              <Pressable
                key={chip.key}
                onPress={() => cycleSort(chip.key)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: active ? colors.accentMuted : colors.surface,
                    borderColor: active ? colors.accent : 'transparent',
                  },
                ]}
              >
                <Text
                  style={[type.caption, { color: active ? colors.accent : colors.textMuted }]}
                >
                  {chip.label}
                  {active ? (descending ? ' ↓' : ' ↑') : ''}
                </Text>
              </Pressable>
            );
          })}

          <View style={[styles.chipDivider, { backgroundColor: colors.border }]} />

          {[null, ...SECTORS].map((s) => {
            const active = sector === s;
            return (
              <Pressable
                key={s ?? 'all'}
                onPress={() => setSector(s)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: active ? colors.accentMuted : colors.surface,
                    borderColor: active ? colors.accent : 'transparent',
                  },
                ]}
              >
                <Text
                  style={[type.caption, { color: active ? colors.accent : colors.textMuted }]}
                >
                  {s ?? 'All sectors'}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

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
          rows.length > 0 ? (
            <Text style={[type.caption, styles.hint, { color: colors.textFaint }]}>
              Tap a row to watchlist it · press and hold to open it
            </Text>
          ) : null
        }
      />

      <WindowPicker
        visible={pickerOpen}
        window={win}
        onClose={() => setPickerOpen(false)}
        onApply={setCustomWindow}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: space(4), paddingBottom: space(3), gap: space(2.5) },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  themeButton: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  search: {
    borderRadius: radius.md,
    paddingHorizontal: space(3.5),
    paddingVertical: space(2.75),
  },
  windowRow: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  customButton: {
    paddingHorizontal: space(3.5),
    paddingVertical: space(2),
    borderRadius: radius.md,
    borderWidth: 1,
  },
  chipRow: { gap: space(2), paddingRight: space(4), alignItems: 'center' },
  chip: {
    paddingHorizontal: space(3),
    paddingVertical: space(1.75),
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  chipDivider: { width: StyleSheet.hairlineWidth, height: 20, marginHorizontal: space(1) },
  empty: { padding: space(10), alignItems: 'center' },
  hint: { textAlign: 'center', paddingVertical: space(5) },
});
