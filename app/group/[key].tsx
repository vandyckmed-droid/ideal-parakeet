import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GroupTicker, groupsForK } from '../../src/data/groups';
import { GroupDetail } from '../../src/screens/GroupDetail';
import { useAppState } from '../../src/state/AppState';
import { getOrderedGroups } from '../../src/state/listContext';
import { useColors } from '../../src/theme/ThemeProvider';
import { radius, space, type } from '../../src/theme/theme';

/**
 * The group pager - the same shell as the ticker pager, one swipe apart. The
 * right-hand action mirrors the star with the group's own collect gesture.
 */
export default function GroupRoute() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const {
    window: win, skipEnabled, sessionsStale, groupCount,
    familyCompare, toggleFamilyCompare,
  } = useAppState();

  const groups = useMemo(() => groupsForK(groupCount).groups, [groupCount]);
  const byMedoid = useMemo(
    () => new Map(groups.map((g) => [g.medoid, g])),
    [groups]
  );

  // Frozen on mount, same reasoning as the ticker pager: the list behind this
  // screen re-sorts as the window and metric change, and a pager whose pages
  // reorder underneath the finger swipes somewhere unpredictable.
  const keys = useMemo(() => {
    const ordered = getOrderedGroups().filter((k) => byMedoid.has(k));
    return ordered.length ? ordered : groups.map((g) => g.medoid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const initialIndex = Math.max(0, keys.indexOf(key));
  const [index, setIndex] = useState(initialIndex);

  const current = byMedoid.get(keys[index]);
  const compared = current ? familyCompare.includes(current.medoid) : false;

  const onScroll = useCallback(
    (e: { nativeEvent: { contentOffset: { x: number } } }) => {
      const next = Math.round(e.nativeEvent.contentOffset.x / width);
      setIndex((prev) => {
        if (prev === next || next < 0 || next >= keys.length) return prev;
        Haptics.selectionAsync().catch(() => {});
        return next;
      });
    },
    [width, keys.length]
  );

  const [scrubbing, setScrubbing] = useState(false);

  const renderPage = useCallback(
    ({ item }: { item: string }) => {
      const group = byMedoid.get(item) as GroupTicker;
      if (!group) return <View style={{ width }} />;
      return (
        <GroupDetail
          group={group}
          initialPreset={win.preset}
          width={width}
          skipEnabled={skipEnabled}
          sessionsStale={sessionsStale}
          onScrubbingChange={setScrubbing}
        />
      );
    },
    [win.preset, width, skipEnabled, sessionsStale, byMedoid]
  );

  if (!current) {
    return (
      <View style={[styles.missing, { backgroundColor: colors.bg, paddingTop: insets.top }]}>
        <Text style={[type.body, { color: colors.textMuted }]}>
          That group no longer exists at {groupCount} groups.
        </Text>
        <Pressable
          onPress={() => router.back()}
          style={[styles.circle, { backgroundColor: colors.surface, marginTop: space(4) }]}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Text style={{ color: colors.text, fontSize: 17 }}>‹</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.bg, paddingTop: insets.top }]}>
      <View style={styles.bar}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          style={[styles.circle, { backgroundColor: colors.surface }]}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Text style={{ color: colors.text, fontSize: 17 }}>‹</Text>
        </Pressable>

        <View style={styles.barCentre}>
          <Text style={[type.heading, { color: colors.text }]} numberOfLines={1}>
            {current.medoid} group
          </Text>
          <Text style={[type.micro, { color: colors.textFaint }]}>
            {index + 1} of {keys.length} · swipe to browse
          </Text>
        </View>

        <Pressable
          onPress={() => {
            const added = toggleFamilyCompare(current.medoid);
            Haptics.impactAsync(
              added ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Medium
            ).catch(() => {});
          }}
          hitSlop={12}
          style={[
            styles.circle,
            { backgroundColor: compared ? colors.accent : colors.surface },
          ]}
          accessibilityRole="button"
          accessibilityLabel={compared ? 'Remove from compare set' : 'Add to compare set'}
        >
          <Text style={{ color: compared ? colors.bg : colors.textMuted, fontSize: 15 }}>
            ◉
          </Text>
        </Pressable>
      </View>

      <FlatList
        data={keys}
        keyExtractor={(k) => k}
        renderItem={renderPage}
        horizontal
        pagingEnabled
        scrollEnabled={!scrubbing}
        showsHorizontalScrollIndicator={false}
        initialScrollIndex={initialIndex}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        onScroll={onScroll}
        scrollEventThrottle={16}
        initialNumToRender={1}
        maxToRenderPerBatch={2}
        windowSize={3}
        removeClippedSubviews
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  missing: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space(4),
    paddingVertical: space(2),
    gap: space(2),
  },
  barCentre: { alignItems: 'center', gap: 1, flexShrink: 1 },
  circle: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
