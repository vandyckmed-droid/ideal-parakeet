// Mirrors src/screens/FamilyListScreen.tsx - if these two ever disagree, the
// .tsx file is the one that is wrong.
//
// The Market tab's family body: the 38 industry families as rows that behave
// like stocks. The families are ticker-shaped, so the shared window, Skip and
// metric state - and the same computeWindowStats, skip clamp and residual
// regression - apply unchanged; under the metric sort the rows rank
// best-first exactly like the card view.
//
// Tap toggles a family onto the comparison chart, the same gesture that
// toggles a stock onto the watchlist. Up to four, oldest rolls off, never
// below one. The chart draws the measured stretch indexed to 100 at the
// window start, because the families opened their $10,000 on different dates
// and raw levels would compare start dates rather than performance.

import React, { useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { CompareChart, Sparkline } from './ui';
import { useTheme, mono, space, type } from './theme';
import { computeWindowStats, formatMetric, metricValue, slice, withSkip } from './stats';

/**
 * Family series re-aligned onto the app's master calendar by date,
 * forward-filling any master session the research calendar lacks - the same
 * tolerance stage 3 applies to a missing print.
 */
export function alignFamilies(research, dates) {
  if (!research || !Array.isArray(research.families) || !research.familyDates) return [];
  return research.families
    .map((f) => {
      const valueAt = new Map(research.familyDates.map((d, i) => [d, f.values[i]]));
      let offset = -1;
      for (let i = 0; i < dates.length; i++) {
        if (valueAt.has(dates[i])) { offset = i; break; }
      }
      if (offset < 0) return null;
      const p = new Array(dates.length - offset);
      let last = valueAt.get(dates[offset]);
      for (let i = offset; i < dates.length; i++) {
        const v = valueAt.get(dates[i]);
        if (v != null) last = v;
        p[i - offset] = last;
      }
      return { s: f.key, o: offset, p, members: f.n, mc: f.n, adv: f.n };
    })
    .filter(Boolean);
}

/** The one filter predicate, shared with the header's live family count. */
export function filterFamilies(families, query) {
  const needle = query.trim().toUpperCase();
  return needle ? families.filter((f) => f.s.toUpperCase().includes(needle)) : families;
}

export function FamilyBody({
  families, dates, win, metric, skipEnabled, sessionsStale,
  query, sortKey, descending, selected, onToggle,
}) {
  const { colors } = useTheme();

  const range = useMemo(
    () => withSkip(win, skipEnabled, sessionsStale, dates.length - 1),
    [win, skipEnabled, sessionsStale, dates.length]
  );

  const rows = useMemo(() => {
    const scored = filterFamilies(families, query).map((f) => ({
      family: f,
      stats: computeWindowStats(f, range.startIndex, range.endIndex),
    }));
    const dir = descending ? -1 : 1;
    scored.sort((a, b) => {
      if (sortKey === 'name') return a.family.s.localeCompare(b.family.s) * dir;
      if (sortKey === 'size') return (a.family.members - b.family.members) * dir;
      const av = metricValue(a.stats, metric);
      const bv = metricValue(b.stats, metric);
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return (av - bv) * dir;
    });
    return scored;
  }, [families, query, range, metric, sortKey, descending]);

  const chart = useMemo(
    () =>
      selected
        .map((key, slot) => {
          const f = families.find((x) => x.s === key);
          if (!f) return null;
          const vals = slice(f, range.startIndex, range.endIndex);
          if (vals.length < 2) return null;
          const base = vals[0];
          return {
            key,
            color: colors.chart[slot % colors.chart.length],
            values: vals.map((v) => (v / base) * 100),
          };
        })
        .filter(Boolean),
    [selected, families, range, colors]
  );

  if (!families.length) {
    return (
      <View style={s.empty}>
        <Text style={[type.body, s.emptyText, { color: colors.textMuted }]}>
          The family series hasn’t been published yet. It arrives with the next
          data update.
        </Text>
      </View>
    );
  }

  const renderRow = ({ item, index }) => {
    const f = item.family;
    const v = metricValue(item.stats, metric);
    const tone = v === null ? colors.flat : v >= 0 ? colors.up : colors.down;
    const slot = selected.indexOf(f.s);
    const activeHue = slot >= 0 ? colors.chart[slot % colors.chart.length] : null;
    const spark = slice(f, range.startIndex, range.endIndex);
    return (
      <Pressable
        onPress={() => onToggle(f.s)}
        style={({ pressed }) => [
          s.row,
          { backgroundColor: pressed ? colors.surface : 'transparent', borderBottomColor: colors.hairline },
        ]}
        accessibilityRole="button"
        accessibilityState={{ selected: slot >= 0 }}
        accessibilityHint="Tap to toggle this family on the comparison chart"
      >
        {/* Rank only under the metric sort, matching the card view: under
            Size or A–Z the position is not a rank and must not read as one. */}
        <Text style={[type.micro, mono, s.rank, { color: colors.textFaint }]}>
          {sortKey === 'metric' ? index + 1 : ''}
        </Text>
        <View style={[s.dot, activeHue ? { backgroundColor: activeHue } : null]} />
        <View style={s.identity}>
          <Text style={[type.bodyStrong, { color: colors.text }]} numberOfLines={1}>{f.s}</Text>
          <Text style={[type.micro, { color: colors.textMuted }]}>{f.members} members</Text>
        </View>
        <Sparkline values={spark} color={tone} />
        <Text style={[type.bodyStrong, mono, s.value, { color: tone }]}>
          {formatMetric(v, metric)}
        </Text>
      </Pressable>
    );
  };

  return (
    <View style={s.root}>
      <View style={s.chartBlock}>
        <CompareChart lines={chart} height={160} baseline={100} />
        <Text style={[type.micro, { color: colors.textFaint }]}>
          Tap a family to chart it · up to four, oldest rolls off · indexed to 100 at the
          window start
        </Text>
      </View>

      <FlatList
        data={rows}
        keyExtractor={(r) => r.family.s}
        renderItem={renderRow}
        initialNumToRender={16}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: space(6) }}
        ListEmptyComponent={
          <View style={s.empty}>
            <Text style={[type.body, { color: colors.textMuted }]}>
              Nothing matches those filters.
            </Text>
          </View>
        }
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  chartBlock: { paddingHorizontal: space(4), paddingBottom: space(2), gap: space(2) },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: space(3),
    paddingHorizontal: space(4), paddingVertical: space(2.5),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rank: { width: 22, textAlign: 'right' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  identity: { flex: 1, gap: 1 },
  value: { minWidth: 84, textAlign: 'right' },
  empty: { padding: space(10), alignItems: 'center' },
  emptyText: { textAlign: 'center', maxWidth: 300 },
});
