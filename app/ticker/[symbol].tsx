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

import { BY_SYMBOL, TICKERS, Ticker } from '../../src/data/market';
import { TickerDetail } from '../../src/screens/TickerDetail';
import { useAppState } from '../../src/state/AppState';
import { getOrderedSymbols } from '../../src/state/listContext';
import { useColors } from '../../src/theme/ThemeProvider';
import { radius, space, type } from '../../src/theme/theme';

export default function TickerRoute() {
  const { symbol } = useLocalSearchParams<{ symbol: string }>();
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { window: win, skipEnabled, sessionsStale, isWatched, toggleWatch } = useAppState();

  // Frozen on mount. The list behind this screen keeps re-sorting as the
  // window and metric change, and a pager whose pages reorder underneath the
  // user's finger would swipe somewhere unpredictable.
  const symbols = useMemo(() => {
    const ordered = getOrderedSymbols();
    const usable = ordered.filter((s) => BY_SYMBOL.has(s));
    return usable.length ? usable : TICKERS.map((t) => t.symbol);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const initialIndex = Math.max(0, symbols.indexOf(symbol));
  const [index, setIndex] = useState(initialIndex);

  const current = BY_SYMBOL.get(symbols[index]);
  const watched = current ? isWatched(current.symbol) : false;

  // Driven from onScroll rather than onMomentumScrollEnd: a slow drag-and-
  // release carries no momentum, so waiting for that event leaves the header
  // naming the previous ticker while a different one is on screen. Rounding to
  // the nearest page means this only changes state once per page crossed.
  const onScroll = useCallback(
    (e: { nativeEvent: { contentOffset: { x: number } } }) => {
      const next = Math.round(e.nativeEvent.contentOffset.x / width);
      setIndex((prev) => {
        if (prev === next || next < 0 || next >= symbols.length) return prev;
        Haptics.selectionAsync().catch(() => {});
        return next;
      });
    },
    [width, symbols.length]
  );

  const renderPage = useCallback(
    ({ item }: { item: string }) => {
      const ticker = BY_SYMBOL.get(item) as Ticker;
      return (
        <TickerDetail
          ticker={ticker}
          initialPreset={win.preset}
          width={width}
          skipEnabled={skipEnabled}
          sessionsStale={sessionsStale}
        />
      );
    },
    [win.preset, width, skipEnabled, sessionsStale]
  );

  if (!current) {
    return (
      <View style={[styles.missing, { backgroundColor: colors.bg }]}>
        <Text style={[type.body, { color: colors.textMuted }]}>
          Unknown symbol.
        </Text>
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
          <Text style={[type.heading, { color: colors.text }]}>{current.symbol}</Text>
          <Text style={[type.micro, { color: colors.textFaint }]}>
            {index + 1} of {symbols.length} · swipe to browse
          </Text>
        </View>

        <Pressable
          onPress={() => {
            Haptics.impactAsync(
              watched
                ? Haptics.ImpactFeedbackStyle.Medium
                : Haptics.ImpactFeedbackStyle.Light
            ).catch(() => {});
            toggleWatch(current.symbol);
          }}
          hitSlop={12}
          style={[
            styles.circle,
            { backgroundColor: watched ? colors.accent : colors.surface },
          ]}
          accessibilityRole="button"
          accessibilityLabel={watched ? 'Remove from watchlist' : 'Add to watchlist'}
        >
          <Text style={{ color: watched ? colors.bg : colors.textMuted, fontSize: 15 }}>
            ★
          </Text>
        </Pressable>
      </View>

      <FlatList
        data={symbols}
        keyExtractor={(s) => s}
        renderItem={renderPage}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        initialScrollIndex={initialIndex}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        onScroll={onScroll}
        scrollEventThrottle={16}
        // Only the neighbours stay mounted; each page holds a chart and a full
        // stats table, so keeping 500 of them alive is not an option.
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
  },
  barCentre: { alignItems: 'center', gap: 1 },
  circle: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
