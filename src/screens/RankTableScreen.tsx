import { useRouter } from 'expo-router';
import React, { useCallback, useDeferredValue, useMemo, useState } from 'react';
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

import { RANK_ROW_HEIGHT, RankRow } from '../components/RankRow';
import { SegmentedControl } from '../components/SegmentedControl';
import { SECTORS, TICKERS } from '../data/market';
import { HORIZONS, buildRankTable } from '../data/ranks';
import { MetricKey } from '../data/stats';
import { useAppState } from '../state/AppState';
import { useTheme } from '../theme/ThemeProvider';
import { mono, radius, space, type } from '../theme/theme';

const METRIC_SEGMENTS: { key: MetricKey; label: string }[] = [
  { key: 'return', label: 'Return' },
  { key: 'ratio', label: 'Return ÷ σ' },
  { key: 'residual', label: 'Residual' },
];

/** Default sort column: the longest horizon, where rank is least noisy. */
const DEFAULT_SORT = HORIZONS.length - 1;

/**
 * The Market tab's table view: every name's rank at 1M / 3M / 6M / 9M / 12M at
 * once, as a heatmap.
 *
 * The card view answers "how is this name doing over the one window I chose";
 * this answers the question that needs five windows side by side - whether a
 * name is strong everywhere or only recently, which is invisible when you can
 * only see one horizon at a time and have to hold the other four in memory.
 *
 * Deliberately carries no overlap badges or overlap header count. Those exist
 * to warn about redundancy against your watchlist, which is a different
 * question from momentum persistence, and at this row density the badges would
 * crowd out the thing the view is for.
 */
export function RankTableScreen({ headerAccessory }: { headerAccessory?: React.ReactNode }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, scheme, preference, setPreference } = useTheme();
  const {
    metric, setMetric, skipEnabled, setSkipEnabled, sessionsStale, isWatched, toggleWatch,
  } = useAppState();

  const [query, setQuery] = useState('');
  const [sector, setSector] = useState<string | null>(null);
  const [sortColumn, setSortColumn] = useState(DEFAULT_SORT);
  const [bestFirst, setBestFirst] = useState(true);

  const deferredQuery = useDeferredValue(query);

  // Five horizons over 500 names. Keyed only on metric and skip, so it survives
  // typing, filtering, sorting and scrolling - none of which change a rank.
  const table = useMemo(
    () => buildRankTable(TICKERS, metric, skipEnabled, sessionsStale),
    [metric, skipEnabled, sessionsStale]
  );

  const rows = useMemo(() => {
    const needle = deferredQuery.trim().toUpperCase();
    const built = TICKERS.filter((t) => (sector ? t.sector === sector : true))
      .filter((t) =>
        needle ? t.symbol.includes(needle) || t.name.toUpperCase().includes(needle) : true
      )
      .map((t) => ({ ticker: t, ranks: table.ranks.get(t.symbol)! }));

    const dir = bestFirst ? 1 : -1;
    built.sort((a, b) => {
      const av = a.ranks[sortColumn];
      const bv = b.ranks[sortColumn];
      // Unranked names sink either way rather than posing as the best or the
      // worst of a horizon they were never in.
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return (av - bv) * dir;
    });
    return built;
  }, [table, deferredQuery, sector, sortColumn, bestFirst]);

  const openDetail = useCallback((symbol: string) => router.push(`/ticker/${symbol}`), [router]);

  const cycleSort = useCallback((column: number) => {
    setSortColumn((prev) => {
      if (prev === column) {
        setBestFirst((b) => !b);
        return prev;
      }
      setBestFirst(true);
      return column;
    });
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: (typeof rows)[number] }) => (
      <RankRow
        ticker={item.ticker}
        ranks={item.ranks}
        counts={table.counts}
        watched={isWatched(item.ticker.symbol)}
        onToggleWatch={toggleWatch}
        onOpenDetail={openDetail}
      />
    ),
    [table.counts, isWatched, toggleWatch, openDetail]
  );

  const skipNote = skipEnabled ? ` · skipping ${table.skips.join('/')}d` : '';

  return (
    <View style={[styles.root, { backgroundColor: colors.bg, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View style={{ flex: 1 }}>
            <Text style={[type.hero, { color: colors.text }]}>Market</Text>
            <Text style={[type.caption, { color: colors.textMuted }]}>
              {rows.length === TICKERS.length
                ? `${TICKERS.length} names`
                : `${rows.length} of ${TICKERS.length} · ranks stay market-wide`}
              {skipNote}
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

        {/* Same row as the search box, matching the card view: both are
            "what am I looking at" controls and neither deserves a full row. */}
        <View style={styles.searchRow}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search symbol or company"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="characters"
            autoCorrect={false}
            clearButtonMode="while-editing"
            style={[styles.search, type.body, { backgroundColor: colors.surface, color: colors.text }]}
          />
          {headerAccessory ? <View style={styles.accessory}>{headerAccessory}</View> : null}
        </View>

        <View style={styles.controlRow}>
          <View style={{ flex: 1 }}>
            <SegmentedControl<MetricKey>
              segments={METRIC_SEGMENTS}
              value={metric}
              onChange={setMetric}
              compact
            />
          </View>
          <Pressable
            onPress={() => setSkipEnabled(!skipEnabled)}
            style={[
              styles.skipButton,
              {
                backgroundColor: skipEnabled ? colors.accentMuted : colors.surface,
                borderColor: skipEnabled ? colors.accent : 'transparent',
              },
            ]}
            accessibilityRole="switch"
            accessibilityState={{ checked: skipEnabled }}
            accessibilityLabel={
              skipEnabled
                ? `Skipping recent sessions: ${table.skips.join(', ')} by horizon`
                : 'Include the most recent trading days'
            }
          >
            <Text
              style={[type.caption, { color: skipEnabled ? colors.accent : colors.textMuted }]}
            >
              Skip
            </Text>
          </Pressable>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
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
                <Text style={[type.caption, { color: active ? colors.accent : colors.textMuted }]}>
                  {s ?? 'All sectors'}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* Column headers double as the sort control - there is nothing else in
          this view to sort by, so a separate row of sort chips would be a
          second way to say the same thing. */}
      <View style={[styles.columnHeader, { borderBottomColor: colors.border }]}>
        <View style={styles.headerSpacer} />
        {HORIZONS.map((horizon, i) => {
          const active = sortColumn === i;
          return (
            <Pressable
              key={horizon.key}
              onPress={() => cycleSort(i)}
              style={styles.headerCell}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`Sort by ${horizon.label} rank`}
            >
              <Text
                style={[
                  type.micro,
                  mono,
                  { color: active ? colors.accent : colors.textFaint },
                ]}
              >
                {horizon.label}
              </Text>
              <Text style={[type.micro, { color: active ? colors.accent : 'transparent' }]}>
                {bestFirst ? '↑' : '↓'}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <FlatList
        data={rows}
        keyExtractor={(r) => r.ticker.symbol}
        renderItem={renderItem}
        getItemLayout={(_, index) => ({
          length: RANK_ROW_HEIGHT,
          offset: RANK_ROW_HEIGHT * index,
          index,
        })}
        initialNumToRender={18}
        maxToRenderPerBatch={16}
        windowSize={9}
        removeClippedSubviews
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: insets.bottom + space(6) }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={[type.body, { color: colors.textMuted }]}>
              Nothing matches those filters.
            </Text>
          </View>
        }
        ListFooterComponent={
          rows.length > 0 ? (
            <Text style={[type.caption, styles.hint, { color: colors.textFaint }]}>
              1 is the best rank of {table.counts[sortColumn]} · tap a column to sort by it
            </Text>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: space(4), paddingBottom: space(2), gap: space(2) },
  headerTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  themeButton: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchRow: { flexDirection: 'row', alignItems: 'stretch', gap: space(2) },
  // minWidth 0: otherwise the placeholder's width is the field's minimum and
  // the view switch gets shoved off the right edge.
  search: { flex: 1, minWidth: 0, borderRadius: radius.md, paddingHorizontal: space(3.5), paddingVertical: space(2.75) },
  // Three segments now (Card / Table / Families); 148 fit two.
  accessory: { width: 208, justifyContent: 'center' },
  controlRow: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  skipButton: {
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
  columnHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: space(3),
    paddingBottom: space(1.5),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerSpacer: { flex: 1, marginLeft: space(4) },
  headerCell: { width: 46, alignItems: 'center' },
  empty: { padding: space(10), alignItems: 'center' },
  hint: { textAlign: 'center', paddingVertical: space(5) },
});
