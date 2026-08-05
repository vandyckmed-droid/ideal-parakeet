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

import { ROW_HEIGHT, TickerRow } from '../components/TickerRow';
import { SegmentedControl } from '../components/SegmentedControl';
import { WindowPicker } from '../components/WindowPicker';
import { DATES, SECTORS, Ticker, formatDateShort, slice } from '../data/market';
import { MetricKey, computeWindowStats, metricValue } from '../data/stats';
import { PRESETS, PresetKey } from '../data/windows';
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
}: {
  title: string;
  universe: Ticker[];
  emptyState?: React.ReactNode;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, scheme, preference, setPreference } = useTheme();
  const { window: win, setPreset, setCustomWindow, metric, setMetric, isWatched, toggleWatch } =
    useAppState();

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
        stats: computeWindowStats(t, win.startIndex, win.endIndex),
        series: slice(t, win.startIndex, win.endIndex),
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
  }, [universe, deferredQuery, sector, sortKey, descending, metric, win]);

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
      />
    ),
    [metric, isWatched, toggleWatch, openDetail, sortKey]
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
              {formatDateShort(DATES[win.endIndex])}
            </Text>
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

        {win.preset === 'CUSTOM' && (
          <Text style={[type.caption, mono, { color: colors.textMuted }]}>
            {DATES[win.startIndex]} → {DATES[win.endIndex]}
          </Text>
        )}

        <SegmentedControl<MetricKey>
          segments={METRIC_SEGMENTS}
          value={metric}
          onChange={setMetric}
        />

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
