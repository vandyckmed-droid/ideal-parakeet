import * as Haptics from 'expo-haptics';
import React, { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { daysUntilEarnings, earningsImminent, formatDaysUntil } from '../data/earnings';
import { Ticker } from '../data/market';
import { OVERLAP_THRESHOLD } from '../data/overlap';
import {
  MetricKey,
  WindowStats,
  formatMetric,
  formatPrice,
  metricValue,
} from '../data/stats';
import { useColors } from '../theme/ThemeProvider';
import { mono, radius, space, type } from '../theme/theme';
import { Sparkline } from './Sparkline';

export const ROW_HEIGHT = 64;

type Props = {
  ticker: Ticker;
  stats: WindowStats | null;
  series: number[];
  metric: MetricKey;
  watched: boolean;
  onToggleWatch: (symbol: string) => void;
  onOpenDetail: (symbol: string) => void;
  rank?: number;
  /**
   * This row's correlation against the current watchlist. Ordinarily set only
   * for names at or above the overlap threshold (Market and Watchlist both
   * pass it that way); while sorted by Overlap, every scored row gets one so
   * the ranking is legible, with tone marking whether it actually crosses the
   * flag threshold.
   */
  overlapScore?: number | null;
};

/**
 * Tap toggles the watchlist; long press opens the per-ticker view.
 *
 * That is the reverse of the usual convention, so the affordance has to carry
 * itself: the watchlist state is mirrored in three places at once - a leading
 * accent bar, the symbol's colour, and a trailing dot - and both gestures fire
 * distinct haptics so the mapping is learned in one or two touches.
 */
export const TickerRow = React.memo(function TickerRow({
  ticker,
  stats,
  series,
  metric,
  watched,
  onToggleWatch,
  onOpenDetail,
  rank,
  overlapScore,
}: Props) {
  const colors = useColors();

  // Only when it is close enough to change what you would do right now. A
  // date three months out is trivia; three days out is the difference between
  // buying today and buying Friday.
  const reportsIn = earningsImminent(ticker.nextEarnings)
    ? daysUntilEarnings(ticker.nextEarnings)
    : null;

  const value = metricValue(stats, metric);
  const tone =
    value === null ? colors.flat : value >= 0 ? colors.up : colors.down;

  const handlePress = useCallback(() => {
    // Selection-style feedback: a light tick for adding, a heavier one for
    // removing, so the direction of the change registers without looking.
    Haptics.impactAsync(
      watched ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light
    ).catch(() => {});
    onToggleWatch(ticker.symbol);
  }, [watched, onToggleWatch, ticker.symbol]);

  const handleLongPress = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    onOpenDetail(ticker.symbol);
  }, [onOpenDetail, ticker.symbol]);

  return (
    <Pressable
      onPress={handlePress}
      onLongPress={handleLongPress}
      delayLongPress={280}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: pressed ? colors.surface : 'transparent',
          borderBottomColor: colors.hairline,
        },
      ]}
      accessibilityRole="button"
      accessibilityLabel={
        `${ticker.symbol}, ${ticker.name}` +
        (reportsIn !== null ? `, reports ${formatDaysUntil(reportsIn)}` : '') +
        (overlapScore != null && overlapScore >= OVERLAP_THRESHOLD
          ? ', overlaps your watchlist'
          : '')
      }
      accessibilityHint="Tap to toggle watchlist, long press to open details"
    >
      <View
        style={[
          styles.marker,
          { backgroundColor: watched ? colors.accent : 'transparent' },
        ]}
      />

      <View style={styles.identity}>
        <View style={styles.symbolLine}>
          {rank !== undefined && (
            <Text style={[type.micro, mono, { color: colors.textFaint }]}>
              {rank}
            </Text>
          )}
          <Text
            style={[
              type.bodyStrong,
              { color: watched ? colors.accent : colors.text },
            ]}
            numberOfLines={1}
          >
            {ticker.symbol}
          </Text>
          {watched && (
            <View style={[styles.dot, { backgroundColor: colors.accent }]} />
          )}
          {reportsIn !== null && (
            <View style={[styles.earningsBadge, { borderColor: colors.border }]}>
              <Text style={[type.micro, mono, { color: colors.textMuted }]}>
                ⚑ {formatDaysUntil(reportsIn)}
              </Text>
            </View>
          )}
          {overlapScore != null && (
            <View
              style={[
                styles.overlapBadge,
                {
                  backgroundColor:
                    overlapScore >= OVERLAP_THRESHOLD ? colors.warnMuted : colors.surface,
                },
              ]}
            >
              <Text
                style={[
                  type.micro,
                  mono,
                  { color: overlapScore >= OVERLAP_THRESHOLD ? colors.warn : colors.textMuted },
                ]}
              >
                ⇄ {Math.round(overlapScore * 100)}%
              </Text>
            </View>
          )}
        </View>
        <Text style={[type.caption, { color: colors.textMuted }]} numberOfLines={1}>
          {ticker.name}
        </Text>
      </View>

      <View style={styles.spark}>
        <Sparkline values={series} color={tone} />
      </View>

      <View style={styles.figures}>
        <Text style={[type.bodyStrong, mono, { color: colors.text }]}>
          {formatPrice(ticker.lastClose)}
        </Text>
        <Text style={[type.caption, mono, { color: tone }]}>
          {formatMetric(value, metric)}
        </Text>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: {
    height: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: space(4),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  marker: {
    width: 3,
    height: 28,
    borderTopRightRadius: radius.sm,
    borderBottomRightRadius: radius.sm,
    marginRight: space(3),
  },
  identity: { flex: 1, justifyContent: 'center', gap: 2 },
  symbolLine: { flexDirection: 'row', alignItems: 'center', gap: space(1.5) },
  dot: { width: 5, height: 5, borderRadius: 3 },
  overlapBadge: {
    paddingHorizontal: space(1.5),
    paddingVertical: 1,
    borderRadius: radius.sm,
  },
  // Outlined rather than filled: this is a date, not a finding, and it should
  // not compete with the overlap flag beside it.
  earningsBadge: {
    paddingHorizontal: space(1.5),
    paddingVertical: 1,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
  },
  spark: { width: 64, marginHorizontal: space(3) },
  figures: { minWidth: 84, alignItems: 'flex-end', gap: 2 },
});
