// Mirrors src/screens/RankTableScreen.tsx - if these two ever disagree, the
// .tsx file is the one that is wrong.

import React, { useCallback, useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { RANK_ROW_HEIGHT, RankRow } from './ui';
import { HORIZONS, buildRankTable } from './ranks';
import { filterUniverse } from './ListScreen';
import { useTheme, mono, space, type } from './theme';

/**
 * The Market tab's table body: every name's rank at 3M / 6M / 9M / 12M at
 * once, as a heatmap.
 *
 * The card view answers "how is this name doing over the one window I chose";
 * this answers the question that needs four windows side by side - whether a
 * name is strong everywhere or only recently.
 *
 * The sorted column is not local state: it is the shared window control,
 * resolved to the nearest horizon. Pick 6M in the header and the table leads
 * with the 6M column; tap the 9M column and the header's window follows. One
 * time axis, whichever view is showing.
 *
 * Deliberately carries no overlap badges or overlap header count: those warn
 * about redundancy against your watchlist, a different question from momentum
 * persistence, and at this row density they would crowd out the ranks.
 */
export function RankTableBody({
  universe, dates, metric, skipEnabled, sessionsStale,
  query, sector, sortColumn, bestFirst, onCycleSort,
  famOf, isWatched, toggleWatch, onOpenDetail,
}) {
  const { colors } = useTheme();

  // Four horizons over 500 names. Keyed only on metric and skip, so it
  // survives typing, filtering, sorting and scrolling - none of which change
  // a rank.
  const table = useMemo(
    () => buildRankTable(universe, dates, metric, skipEnabled, sessionsStale),
    [universe, dates, metric, skipEnabled, sessionsStale]
  );

  // The same name's standing inside its own peer groups, at the sorted
  // horizon. Derived from the market-wide ranks rather than recomputed: a
  // name's position among its sector (or family) peers ordered by market
  // rank IS its rank within that group on the same metric, so the note and
  // the cells can never disagree. Market-wide ranks stay market-wide - this
  // adds context to a row, it does not renumber the table.
  const scopeNotes = useMemo(() => {
    const bySector = new Map();
    const byFamily = new Map();
    for (const t of universe) {
      const rank = table.ranks.get(t.s)[sortColumn];
      if (rank === null) continue;
      if (t.se) {
        if (!bySector.has(t.se)) bySector.set(t.se, []);
        bySector.get(t.se).push({ symbol: t.s, rank });
      }
      const fam = famOf ? famOf.get(t.s) : null;
      if (fam) {
        if (!byFamily.has(fam)) byFamily.set(fam, []);
        byFamily.get(fam).push({ symbol: t.s, rank });
      }
    }
    const position = (groups) => {
      const out = new Map();
      for (const members of groups.values()) {
        members.sort((a, b) => a.rank - b.rank);
        members.forEach((m, i) => out.set(m.symbol, `${i + 1}/${members.length}`));
      }
      return out;
    };
    const sectorPos = position(bySector);
    const familyPos = position(byFamily);
    const notes = new Map();
    for (const t of universe) {
      const parts = [];
      const f = familyPos.get(t.s);
      if (f) parts.push(`Family ${f}`);
      const s = sectorPos.get(t.s);
      if (s) parts.push(`Sector ${s}`);
      if (parts.length) notes.set(t.s, parts.join(' · '));
    }
    return notes;
  }, [universe, table, sortColumn, famOf]);

  const rows = useMemo(() => {
    const built = filterUniverse(universe, query, sector).map((t) => ({
      ticker: t,
      ranks: table.ranks.get(t.s),
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
  }, [universe, table, query, sector, sortColumn, bestFirst]);

  const renderItem = useCallback(
    ({ item }) => (
      <RankRow
        ticker={item.ticker}
        ranks={item.ranks}
        counts={table.counts}
        scopeNote={scopeNotes.get(item.ticker.s)}
        watched={isWatched(item.ticker.s)}
        onToggleWatch={toggleWatch}
        onOpenDetail={onOpenDetail}
      />
    ),
    [table.counts, scopeNotes, isWatched, toggleWatch, onOpenDetail]
  );

  return (
    <View style={s.root}>
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
              onPress={() => onCycleSort(i)}
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
              {'\n'}family and sector standings follow the sorted column
            </Text>
          ) : null
        }
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  columnHeader: {
    flexDirection: 'row', alignItems: 'center', paddingRight: space(3),
    paddingBottom: space(1.5), borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerSpacer: { flex: 1, marginLeft: space(4) },
  headerCell: { width: 46, alignItems: 'center' },
  empty: { padding: space(10), alignItems: 'center' },
  hint: { textAlign: 'center', paddingVertical: space(5) },
});
