import { useRouter } from 'expo-router';
import React, { useCallback, useDeferredValue, useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { RANK_ROW_HEIGHT, RankRow } from '../components/RankRow';
import { filterUniverse } from '../components/StockListBody';
import { groupIndexFor } from '../data/groups';
import { TICKERS } from '../data/market';
import { HORIZONS, buildRankTable } from '../data/ranks';
import { useAppState } from '../state/AppState';
import { useColors } from '../theme/ThemeProvider';
import { mono, space, type } from '../theme/theme';

/**
 * The Market tab's table body: every name's rank at 3M / 6M / 9M / 12M at
 * once, as a heatmap.
 *
 * The card view answers "how is this name doing over the one window I chose";
 * this answers the question that needs four windows side by side - whether a
 * name is strong everywhere or only recently, which is invisible when you can
 * only see one horizon at a time and have to hold the others in memory.
 *
 * The sorted column is not local state: it is the shared window control,
 * resolved to the nearest horizon. Pick 6M in the header and the table leads
 * with the 6M column; tap the 9M column and the header's window follows. One
 * time axis, whichever view is showing.
 *
 * Deliberately carries no overlap badges or overlap header count. Those exist
 * to warn about redundancy against your watchlist, which is a different
 * question from momentum persistence, and at this row density the badges would
 * crowd out the thing the view is for.
 */
export function RankTableBody({
  query,
  sector,
  sortColumn,
  bestFirst,
  onCycleSort,
}: {
  query: string;
  sector: string | null;
  sortColumn: number;
  bestFirst: boolean;
  onCycleSort: (column: number) => void;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { metric, skipEnabled, sessionsStale, groupCount, isWatched, toggleWatch } =
    useAppState();

  const deferredQuery = useDeferredValue(query);

  // Four horizons over 500 names. Keyed only on metric and skip, so it
  // survives typing, filtering, sorting and scrolling - none of which change
  // a rank.
  const table = useMemo(
    () => buildRankTable(TICKERS, metric, skipEnabled, sessionsStale),
    [metric, skipEnabled, sessionsStale]
  );

  // The same name's standing inside its own peer sets, at the sorted horizon.
  // Derived from the market-wide ranks rather than recomputed: a name's
  // position among its sector (or correlation-group) peers ordered by market
  // rank IS its rank within that set on the same metric, so the note and the
  // cells can never disagree. Market-wide ranks stay market-wide - this adds
  // context to a row, it does not renumber the table.
  const scopeNotes = useMemo(() => {
    const groupIndex = groupIndexFor(groupCount);
    const bySector = new Map<string, { symbol: string; rank: number }[]>();
    const byGroup = new Map<string, { symbol: string; rank: number }[]>();
    for (const t of TICKERS) {
      const rank = table.ranks.get(t.symbol)![sortColumn];
      if (rank === null) continue;
      if (t.sector) {
        if (!bySector.has(t.sector)) bySector.set(t.sector, []);
        bySector.get(t.sector)!.push({ symbol: t.symbol, rank });
      }
      const grp = groupIndex.get(t.symbol);
      if (grp) {
        if (!byGroup.has(grp)) byGroup.set(grp, []);
        byGroup.get(grp)!.push({ symbol: t.symbol, rank });
      }
    }
    const position = (groups: Map<string, { symbol: string; rank: number }[]>) => {
      const out = new Map<string, string>();
      for (const members of groups.values()) {
        members.sort((a, b) => a.rank - b.rank);
        members.forEach((m, i) => out.set(m.symbol, `${i + 1}/${members.length}`));
      }
      return out;
    };
    const sectorPos = position(bySector);
    const groupPos = position(byGroup);
    const notes = new Map<string, string>();
    for (const t of TICKERS) {
      const parts: string[] = [];
      const g = groupPos.get(t.symbol);
      if (g) parts.push(`Group ${g}`);
      const s = sectorPos.get(t.symbol);
      if (s) parts.push(`Sector ${s}`);
      if (parts.length) notes.set(t.symbol, parts.join(' · '));
    }
    return notes;
  }, [table, sortColumn, groupCount]);

  const rows = useMemo(() => {
    const built = filterUniverse(TICKERS, deferredQuery, sector).map((t) => ({
      ticker: t,
      ranks: table.ranks.get(t.symbol)!,
    }));

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

  const renderItem = useCallback(
    ({ item }: { item: (typeof rows)[number] }) => (
      <RankRow
        ticker={item.ticker}
        ranks={item.ranks}
        counts={table.counts}
        scopeNote={scopeNotes.get(item.ticker.symbol)}
        watched={isWatched(item.ticker.symbol)}
        onToggleWatch={toggleWatch}
        onOpenDetail={openDetail}
      />
    ),
    [table.counts, scopeNotes, isWatched, toggleWatch, openDetail]
  );

  return (
    <View style={styles.root}>
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
              onPress={() => onCycleSort(i)}
              style={styles.headerCell}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`Sort by ${horizon.label} rank`}
            >
              <Text
                style={[type.micro, mono, { color: active ? colors.accent : colors.textFaint }]}
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
              {'\n'}group and sector standings follow the sorted column
            </Text>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
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
