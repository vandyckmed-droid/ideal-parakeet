// Mirrors src/screens/RankTableScreen.tsx - if these two ever disagree, the
// .tsx file is the one that is wrong.

import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { RANK_ROW_HEIGHT, RankRow, SegmentedControl } from './ui';
import { HORIZONS, buildRankTable } from './ranks';
import { hasMarket } from './stats';
import { useTheme, mono, radius, space, type } from './theme';

const METRICS = [
  { key: 'return', label: 'Return' },
  { key: 'ratio', label: 'Return ÷ σ' },
  { key: 'residual', label: 'Residual' },
];

// Residual drops out when the loaded dataset has no market reference (a
// payload from before the field existed): every value would be a dash, and a
// control that only produces dashes is worse than none. Evaluated per render,
// NOT at module scope - the module loads before the data arrives.
const availableMetrics = () => METRICS.filter((m) => m.key !== 'residual' || hasMarket());

/** Default sort column: the longest horizon, where rank is least noisy. */
const DEFAULT_SORT = HORIZONS.length - 1;

/**
 * The Market tab's table view: every name's rank at 1M / 3M / 6M / 9M / 12M at
 * once, as a heatmap.
 *
 * The card view answers "how is this name doing over the one window I chose";
 * this answers the question that needs five windows side by side - whether a
 * name is strong everywhere or only recently.
 *
 * Deliberately carries no overlap badges or overlap header count: those warn
 * about redundancy against your watchlist, a different question from momentum
 * persistence, and at this row density they would crowd out the ranks.
 */
export function RankTable({
  universe, dates, sectors, metric, setMetric, skipEnabled, setSkipEnabled,
  sessionsStale, isWatched, toggleWatch, onOpenDetail, tab, headerAccessory,
}) {
  const { colors, scheme, preference, setPreference } = useTheme();

  const [query, setQuery] = useState('');
  const [sector, setSector] = useState(null);
  const [sortColumn, setSortColumn] = useState(DEFAULT_SORT);
  const [bestFirst, setBestFirst] = useState(true);

  // Five horizons over 500 names. Keyed only on metric and skip, so it survives
  // typing, filtering, sorting and scrolling - none of which change a rank.
  const table = useMemo(
    () => buildRankTable(universe, dates, metric, skipEnabled, sessionsStale),
    [universe, dates, metric, skipEnabled, sessionsStale]
  );

  const rows = useMemo(() => {
    const needle = query.trim().toUpperCase();
    const built = universe
      .filter((t) => (sector ? t.se === sector : true))
      .filter((t) => (needle ? t.s.includes(needle) || t.n.toUpperCase().includes(needle) : true))
      .map((t) => ({ ticker: t, ranks: table.ranks.get(t.s) }));

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
  }, [universe, table, query, sector, sortColumn, bestFirst]);

  const cycleSort = (column) => {
    if (sortColumn === column) setBestFirst((b) => !b);
    else {
      setSortColumn(column);
      setBestFirst(true);
    }
  };

  const renderItem = useCallback(
    ({ item }) => (
      <RankRow
        ticker={item.ticker}
        ranks={item.ranks}
        counts={table.counts}
        watched={isWatched(item.ticker.s)}
        onToggleWatch={toggleWatch}
        onOpenDetail={onOpenDetail}
      />
    ),
    [table.counts, isWatched, toggleWatch, onOpenDetail]
  );

  const skipNote = skipEnabled ? ` · skipping ${table.skips.join('/')}d` : '';

  return (
    <View style={[s.root, { backgroundColor: colors.bg }]}>
      <View style={s.header}>
        <View style={s.headerTop}>
          <View style={{ flex: 1 }}>
            <Text style={[type.hero, { color: colors.text }]}>Market</Text>
            <Text style={[type.caption, { color: colors.textMuted }]}>
              {rows.length === universe.length
                ? `${universe.length} names`
                : `${rows.length} of ${universe.length} · ranks stay market-wide`}
              {skipNote}
            </Text>
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

        <View style={s.controlRow}>
          <View style={{ flex: 1 }}>
            <SegmentedControl segments={availableMetrics()} value={metric} onChange={setMetric} compact />
          </View>
          <Pressable
            onPress={() => setSkipEnabled(!skipEnabled)}
            style={[
              s.skipButton,
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
            <Text style={[type.caption, { color: skipEnabled ? colors.accent : colors.textMuted }]}>
              Skip
            </Text>
          </Pressable>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipRow}>
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

      {/* Column headers double as the sort control - there is nothing else in
          this view to sort by, so a separate row of sort chips would be a
          second way to say the same thing. */}
      <View style={[s.columnHeader, { borderBottomColor: colors.border }]}>
        <View style={s.headerSpacer} />
        {HORIZONS.map((horizon, i) => {
          const active = sortColumn === i;
          return (
            <Pressable
              key={horizon.key}
              onPress={() => cycleSort(i)}
              style={s.headerCell}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`Sort by ${horizon.label} rank`}
            >
              <Text style={[type.micro, mono, { color: active ? colors.accent : colors.textFaint }]}>
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
        keyExtractor={(r) => r.ticker.s}
        renderItem={renderItem}
        getItemLayout={(_, index) => ({ length: RANK_ROW_HEIGHT, offset: RANK_ROW_HEIGHT * index, index })}
        initialNumToRender={18}
        maxToRenderPerBatch={16}
        windowSize={9}
        removeClippedSubviews
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <View style={s.empty}>
            <Text style={[type.body, { color: colors.textMuted }]}>Nothing matches those filters.</Text>
          </View>
        }
        ListFooterComponent={
          rows.length > 0 ? (
            <Text style={[type.caption, s.hint, { color: colors.textFaint }]}>
              1 is the best rank of {table.counts[sortColumn]} · tap a column to sort by it
            </Text>
          ) : null
        }
      />

      {tab}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: space(4), paddingBottom: space(2), gap: space(2) },
  headerTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  themeButton: { width: 36, height: 36, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  searchRow: { flexDirection: 'row', alignItems: 'stretch', gap: space(2) },
  // minWidth 0: otherwise the placeholder's width is the field's minimum and
  // the view switch gets shoved off the right edge.
  search: { flex: 1, minWidth: 0, borderRadius: radius.md, paddingHorizontal: space(3.5), paddingVertical: space(2.75) },
  accessory: { width: 148, justifyContent: 'center' },
  controlRow: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  skipButton: { paddingHorizontal: space(3.5), paddingVertical: space(2), borderRadius: radius.md, borderWidth: 1 },
  chipRow: { gap: space(2), paddingRight: space(4), alignItems: 'center' },
  chip: { paddingHorizontal: space(3), paddingVertical: space(1.75), borderRadius: radius.pill, borderWidth: 1 },
  columnHeader: {
    flexDirection: 'row', alignItems: 'center', paddingRight: space(3),
    paddingBottom: space(1.5), borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerSpacer: { flex: 1, marginLeft: space(4) },
  headerCell: { width: 46, alignItems: 'center' },
  empty: { padding: space(10), alignItems: 'center' },
  hint: { textAlign: 'center', paddingVertical: space(5) },
});
