// Mirrors src/screens/GroupListScreen.tsx - if these two ever disagree, the
// .tsx file is the one that is wrong.
//
// The Market tab's third view: correlation groups as rows that behave like
// stocks. Each group is an equal-weight index of its members, so the shared
// window, Skip and metric state all apply unchanged. Tap collects a group onto
// the comparison chart; press and hold opens it.

import React, { useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { Sparkline, haptic } from './ui';
import { useTheme, mono, space, type } from './theme';
import { computeWindowStats, formatMetric, metricValue, slice, withSkip } from './stats';
import { groupsForK, hasGrouping } from './groups';

/** The one filter predicate, shared with the header's live group count. */
export function filterGroups(groups, query) {
  const needle = query.trim().toUpperCase();
  if (!needle) return groups;
  // Searching a group by any of its members is the useful behaviour: you know
  // the stock, not which medoid happens to represent it.
  return groups.filter(
    (g) =>
      g.medoid.includes(needle) ||
      g.dominantSector.toUpperCase().includes(needle) ||
      g.members.some((m) => m.includes(needle))
  );
}

export function GroupBody({
  dates, win, metric, skipEnabled, sessionsStale, query, groupCount,
  familyCompare = [], familySlots = {}, toggleFamilyCompare, onOpenGroup,
}) {
  const { colors } = useTheme();

  const range = useMemo(
    () => withSkip(win, skipEnabled, sessionsStale, dates.length - 1),
    [win, skipEnabled, sessionsStale, dates.length]
  );

  const groups = useMemo(() => groupsForK(groupCount).groups, [groupCount]);

  const rows = useMemo(() => {
    const scored = filterGroups(groups, query).map((g) => ({
      group: g,
      stats: computeWindowStats(g, range.startIndex, range.endIndex),
    }));
    scored.sort((a, b) => {
      const av = metricValue(a.stats, metric);
      const bv = metricValue(b.stats, metric);
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return bv - av;
    });
    return scored;
  }, [groups, query, range, metric]);

  if (!hasGrouping()) {
    return (
      <View style={s.empty}>
        <Text style={[type.body, s.emptyText, { color: colors.textMuted }]}>
          The correlation matrix hasn’t been published yet. It arrives with the
          next data update.
        </Text>
      </View>
    );
  }

  const renderRow = ({ item, index }) => {
    const g = item.group;
    const v = metricValue(item.stats, metric);
    const tone = v === null ? colors.flat : v >= 0 ? colors.up : colors.down;
    const slot = familySlots[g.medoid];
    const activeHue = slot != null ? colors.chart[slot % colors.chart.length] : null;
    const spark = slice(g, range.startIndex, range.endIndex);
    return (
      <Pressable
        onPress={() => {
          const adding = !familyCompare.includes(g.medoid);
          haptic(() =>
            Haptics.impactAsync(
              adding ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Medium
            )
          );
          toggleFamilyCompare(g.medoid);
        }}
        onLongPress={() => {
          haptic(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
          onOpenGroup(g.medoid, rows.map((r) => r.group.medoid));
        }}
        delayLongPress={280}
        style={({ pressed }) => [
          s.row,
          { backgroundColor: pressed ? colors.surface : 'transparent', borderBottomColor: colors.hairline },
        ]}
        accessibilityRole="button"
        accessibilityState={{ selected: slot != null }}
        accessibilityHint="Tap to add to the compare set, press and hold to open"
      >
        <Text style={[type.micro, mono, s.rank, { color: colors.textFaint }]}>{index + 1}</Text>
        <View style={[s.dot, activeHue ? { backgroundColor: activeHue } : null]} />
        <View style={s.identity}>
          <Text style={[type.bodyStrong, { color: colors.text }]} numberOfLines={1}>
            {g.medoid}
            <Text style={[type.micro, { color: colors.textFaint }]}> group</Text>
          </Text>
          <Text style={[type.micro, { color: colors.textMuted }]} numberOfLines={1}>
            {g.members.length} · {g.dominantSector || 'mixed'} {Math.round(g.dominantShare * 100)}% · ρ{' '}
            {g.cohesion.toFixed(2)}
          </Text>
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
      keyExtractor={(r) => r.group.medoid}
      renderItem={renderRow}
      initialNumToRender={16}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingBottom: space(6) }}
      ListEmptyComponent={
        <View style={s.empty}>
          <Text style={[type.body, { color: colors.textMuted }]}>No group matches that search.</Text>
        </View>
      }
      ListFooterComponent={
        rows.length > 0 ? (
          <Text style={[type.caption, s.hint, { color: colors.textFaint }]}>
            Tap a group to compare it · press and hold to open it
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
