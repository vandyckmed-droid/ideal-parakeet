import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { useCallback, useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Sparkline } from '../components/Sparkline';
import { GROUPING_AVAILABLE, GroupTicker, groupsForK } from '../data/groups';
import { slice } from '../data/market';
import { computeWindowStats, formatMetric, metricValue } from '../data/stats';
import { withSkip } from '../data/windows';
import { useAppState } from '../state/AppState';
import { setOrderedGroups } from '../state/listContext';
import { useColors } from '../theme/ThemeProvider';
import { mono, space, type } from '../theme/theme';

/** The one filter predicate, shared with the header's live group count. */
export function filterGroups(groups: GroupTicker[], query: string): GroupTicker[] {
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

/**
 * The Market tab's third view: correlation groups as rows that behave like
 * stocks. Each group is an equal-weight index of its members, so the shared
 * window, Skip and metric state all apply unchanged.
 *
 * Tap collects a group onto the comparison chart; press and hold opens it.
 */
export function GroupBody({ query }: { query: string }) {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const router = useRouter();
  const {
    window: win, metric, skipEnabled, sessionsStale, groupCount,
    familyCompare, toggleFamilyCompare, familySlots,
  } = useAppState();

  const range = useMemo(
    () => withSkip(win, skipEnabled, sessionsStale),
    [win, skipEnabled, sessionsStale]
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

  const collect = useCallback(
    (key: string) => {
      const added = toggleFamilyCompare(key);
      Haptics.impactAsync(
        added ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Medium
      ).catch(() => {});
    },
    [toggleFamilyCompare]
  );

  const open = useCallback(
    (key: string) => {
      setOrderedGroups(rows.map((r) => r.group.medoid));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      router.push(`/group/${encodeURIComponent(key)}`);
    },
    [rows, router]
  );

  const renderRow = ({ item, index }: { item: (typeof rows)[number]; index: number }) => {
    const g = item.group;
    const v = metricValue(item.stats, metric);
    const tone = v === null ? colors.flat : v >= 0 ? colors.up : colors.down;
    const slot = familySlots[g.medoid];
    const activeHue = slot != null ? colors.chart[slot % colors.chart.length] : null;
    const spark = slice(g, range.startIndex, range.endIndex);
    return (
      <Pressable
        onPress={() => collect(g.medoid)}
        onLongPress={() => open(g.medoid)}
        delayLongPress={280}
        style={({ pressed }) => [
          styles.row,
          {
            backgroundColor: pressed ? colors.surface : 'transparent',
            borderBottomColor: colors.hairline,
          },
        ]}
        accessibilityRole="button"
        accessibilityState={{ selected: slot != null }}
        accessibilityHint="Tap to add to the compare set, press and hold to open"
      >
        <Text style={[type.micro, mono, styles.rank, { color: colors.textFaint }]}>
          {index + 1}
        </Text>
        {activeHue ? (
          <View style={[styles.dot, { backgroundColor: activeHue }]} />
        ) : (
          <View style={styles.dot} />
        )}
        <View style={styles.identity}>
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
        <Text style={[type.bodyStrong, mono, styles.value, { color: tone }]}>
          {formatMetric(v, metric)}
        </Text>
      </Pressable>
    );
  };

  if (!GROUPING_AVAILABLE) {
    return (
      <View style={styles.empty}>
        <Text style={[type.body, styles.emptyText, { color: colors.textMuted }]}>
          The correlation matrix hasn’t been published yet. It arrives with the
          next data update.
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      data={rows}
      keyExtractor={(r) => r.group.medoid}
      renderItem={renderRow}
      initialNumToRender={16}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingBottom: insets.bottom + space(6) }}
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text style={[type.body, { color: colors.textMuted }]}>
            No group matches that search.
          </Text>
        </View>
      }
      ListFooterComponent={
        rows.length > 0 ? (
          <Text style={[type.caption, styles.hint, { color: colors.textFaint }]}>
            Tap a group to compare it · press and hold to open it
          </Text>
        ) : null
      }
    />
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(3),
    paddingHorizontal: space(4),
    paddingVertical: space(2.5),
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
