import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { useCallback, useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Sparkline } from '../components/Sparkline';
import { FAMILY_TICKERS, FamilyTicker } from '../data/families';
import { slice } from '../data/market';
import { computeWindowStats, formatMetric, metricValue } from '../data/stats';
import { withSkip } from '../data/windows';
import { useAppState } from '../state/AppState';
import { setOrderedFamilies } from '../state/listContext';
import { useColors } from '../theme/ThemeProvider';
import { mono, space, type } from '../theme/theme';

export type FamilySortKey = 'metric' | 'size' | 'name';

/** The one filter predicate, shared with the header's live family count. */
export function filterFamilies(query: string): FamilyTicker[] {
  const needle = query.trim().toUpperCase();
  return needle
    ? FAMILY_TICKERS.filter((f) => f.symbol.toUpperCase().includes(needle))
    : FAMILY_TICKERS;
}

/**
 * The Market tab's family body: the 38 industry families as rows that behave
 * like stocks - the same look, the same maths, and now the same gesture pair
 * as the card view. Tap collects a family into the compare set (the family
 * analogue of the watchlist; its dot takes the comparison colour). Press and
 * hold opens the family's own page - chart, every window's numbers, and its
 * holdings - which is also where the compare set gets drawn.
 */
export function FamilyBody({
  query,
  sortKey,
  descending,
}: {
  query: string;
  sortKey: FamilySortKey;
  descending: boolean;
}) {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const router = useRouter();
  const {
    window: win, metric, skipEnabled, sessionsStale, familyCompare, toggleFamilyCompare,
  } = useAppState();

  const range = useMemo(
    () => withSkip(win, skipEnabled, sessionsStale),
    [win, skipEnabled, sessionsStale]
  );

  const rows = useMemo(() => {
    const scored = filterFamilies(query).map((f) => ({
      family: f,
      stats: computeWindowStats(f, range.startIndex, range.endIndex),
    }));
    const dir = descending ? -1 : 1;
    scored.sort((a, b) => {
      if (sortKey === 'name') return a.family.symbol.localeCompare(b.family.symbol) * dir;
      if (sortKey === 'size') return (a.family.members - b.family.members) * dir;
      const av = metricValue(a.stats, metric);
      const bv = metricValue(b.stats, metric);
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return (av - bv) * dir;
    });
    return scored;
  }, [query, range, metric, sortKey, descending]);

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
      // Publish the visible order so the detail pager swipes through the
      // same list the finger just left.
      setOrderedFamilies(rows.map((r) => r.family.symbol));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      router.push(`/family/${encodeURIComponent(key)}`);
    },
    [rows, router]
  );

  const renderRow = ({ item, index }: { item: (typeof rows)[number]; index: number }) => {
    const f = item.family;
    const v = metricValue(item.stats, metric);
    const tone = v === null ? colors.flat : v >= 0 ? colors.up : colors.down;
    const slot = familyCompare.indexOf(f.symbol);
    const activeHue = slot >= 0 ? colors.chart[slot % colors.chart.length] : null;
    const spark = slice(f, range.startIndex, range.endIndex);
    return (
      <Pressable
        onPress={() => collect(f.symbol)}
        onLongPress={() => open(f.symbol)}
        delayLongPress={280}
        style={({ pressed }) => [
          styles.row,
          {
            backgroundColor: pressed ? colors.surface : 'transparent',
            borderBottomColor: colors.hairline,
          },
        ]}
        accessibilityRole="button"
        accessibilityState={{ selected: slot >= 0 }}
        accessibilityHint="Tap to add to the compare set, press and hold to open"
      >
        {/* Rank only under the metric sort, matching the card view: under
            Size or A–Z the position is not a rank and must not read as one. */}
        <Text style={[type.micro, mono, styles.rank, { color: colors.textFaint }]}>
          {sortKey === 'metric' ? index + 1 : ''}
        </Text>
        {activeHue ? (
          <View style={[styles.dot, { backgroundColor: activeHue }]} />
        ) : (
          <View style={styles.dot} />
        )}
        <View style={styles.identity}>
          <Text style={[type.bodyStrong, { color: colors.text }]} numberOfLines={1}>
            {f.symbol}
          </Text>
          <Text style={[type.micro, { color: colors.textMuted }]}>{f.members} members</Text>
        </View>
        <Sparkline values={spark} color={tone} />
        <Text style={[type.bodyStrong, mono, styles.value, { color: tone }]}>
          {formatMetric(v, metric)}
        </Text>
      </Pressable>
    );
  };

  if (!FAMILY_TICKERS.length) {
    return (
      <View style={styles.empty}>
        <Text style={[type.body, styles.emptyText, { color: colors.textMuted }]}>
          The family series hasn’t been published yet. It arrives with the next
          data update.
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      data={rows}
      keyExtractor={(r) => r.family.symbol}
      renderItem={renderRow}
      initialNumToRender={16}
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
            Tap a row to compare it · press and hold to open it
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
