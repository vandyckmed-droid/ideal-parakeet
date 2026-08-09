// Mirrors src/screens/FamilyListScreen.tsx - if these two ever disagree, the
// .tsx file is the one that is wrong.
//
// The Market tab's family body: the 38 industry families as rows that behave
// like stocks - the same look, the same maths, and the same gesture pair as
// the card view. Tap collects a family into the compare set (the family
// analogue of the watchlist; its dot takes the comparison colour). Press and
// hold opens the family's own page - chart, every window's numbers, and its
// holdings - which is also where the compare set gets drawn.

import React, { useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { Sparkline, haptic } from './ui';
import { useTheme, mono, space, type } from './theme';
import { computeWindowStats, formatMetric, metricValue, slice, withSkip } from './stats';

/**
 * Family series re-aligned onto the app's master calendar by date,
 * forward-filling any master session the research calendar lacks - the same
 * tolerance stage 3 applies to a missing print. Carries the current holdings
 * when the payload has them; a payload from before `members` existed falls
 * back to the formation-time count.
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
      const holdings = f.members || [];
      const count = holdings.length || f.n;
      return { s: f.key, o: offset, p, members: count, holdings, mc: count, adv: count };
    })
    .filter(Boolean);
}

/** Reverse lookup map: which family a stock belongs to, if any. */
export function familyBySymbol(families) {
  const m = new Map();
  for (const f of families) for (const sym of f.holdings) m.set(sym, f.s);
  return m;
}

/** The one filter predicate, shared with the header's live family count. */
export function filterFamilies(families, query) {
  const needle = query.trim().toUpperCase();
  return needle ? families.filter((f) => f.s.toUpperCase().includes(needle)) : families;
}

export function FamilyBody({
  families, dates, win, metric, skipEnabled, sessionsStale,
  query, sortKey, descending,
  // Defaulted so a missing prop degrades to "nothing collected" rather than
  // throwing inside a render and blanking the whole app - which is exactly
  // what an unpassed familyCompare did once.
  familyCompare = [], toggleFamilyCompare, onOpenFamily,
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
    const slot = familyCompare.indexOf(f.s);
    const activeHue = slot >= 0 ? colors.chart[slot % colors.chart.length] : null;
    const spark = slice(f, range.startIndex, range.endIndex);
    return (
      <Pressable
        onPress={() => {
          const adding = !familyCompare.includes(f.s);
          haptic(() =>
            Haptics.impactAsync(
              adding ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Medium
            )
          );
          toggleFamilyCompare(f.s);
        }}
        onLongPress={() => {
          haptic(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
          // Publish the visible order so the detail pager swipes through the
          // same list the finger just left.
          onOpenFamily(f.s, rows.map((r) => r.family.s));
        }}
        delayLongPress={280}
        style={({ pressed }) => [
          s.row,
          { backgroundColor: pressed ? colors.surface : 'transparent', borderBottomColor: colors.hairline },
        ]}
        accessibilityRole="button"
        accessibilityState={{ selected: slot >= 0 }}
        accessibilityHint="Tap to add to the compare set, press and hold to open"
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
      ListFooterComponent={
        rows.length > 0 ? (
          <Text style={[type.caption, s.hint, { color: colors.textFaint }]}>
            Tap a row to compare it · press and hold to open it
          </Text>
        ) : null
      }
    />
  );
}

const s = StyleSheet.create({
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
  hint: { textAlign: 'center', paddingVertical: space(5) },
});
