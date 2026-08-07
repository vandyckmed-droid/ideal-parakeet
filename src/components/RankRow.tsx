import * as Haptics from 'expo-haptics';
import React, { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Ticker } from '../data/market';
import { rankHeat } from '../data/ranks';
import { useColors } from '../theme/ThemeProvider';
import { mixHex, mono, radius, space, type, withAlpha } from '../theme/theme';

export const RANK_ROW_HEIGHT = 44;
/** Width of one rank cell. Five of these plus the symbol column fit a phone. */
export const RANK_CELL_WIDTH = 46;

/**
 * Peak background tint. Deliberately low: the cell has to sit behind a number
 * that stays readable in both palettes, and a full-strength fill would turn the
 * table into a block of colour with the ranks fighting it.
 */
const MAX_TINT = 0.26;

function RankCell({ rank, count }: { rank: number | null; count: number }) {
  const colors = useColors();
  const heat = rankHeat(rank, count);

  if (rank === null || heat === null) {
    return (
      <View style={styles.cell}>
        <Text style={[type.caption, mono, { color: colors.textFaint }]}>—</Text>
      </View>
    );
  }

  const pole = heat.side === 'up' ? colors.up : colors.down;
  return (
    <View style={styles.cell}>
      <View
        style={[
          styles.chip,
          { backgroundColor: withAlpha(pole, heat.strength * MAX_TINT) },
        ]}
      >
        <Text
          style={[
            type.caption,
            mono,
            { color: mixHex(colors.textMuted, pole, heat.strength) },
          ]}
        >
          {rank}
        </Text>
      </View>
    </View>
  );
}

type Props = {
  ticker: Ticker;
  ranks: (number | null)[];
  counts: number[];
  watched: boolean;
  onToggleWatch: (symbol: string) => void;
  onOpenDetail: (symbol: string) => void;
};

/**
 * One name's rank at every horizon.
 *
 * Same gestures as the card view's row - tap to watchlist, long press to open -
 * so the two sub-views of the Market tab do not teach different meanings for
 * the same touch.
 */
export const RankRow = React.memo(function RankRow({
  ticker,
  ranks,
  counts,
  watched,
  onToggleWatch,
  onOpenDetail,
}: Props) {
  const colors = useColors();

  const handlePress = useCallback(() => {
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
        `${ticker.symbol}, ${ticker.name}. Ranks: ` +
        ranks.map((r) => (r === null ? 'unranked' : r)).join(', ')
      }
      accessibilityHint="Tap to toggle watchlist, long press to open details"
    >
      <View
        style={[styles.marker, { backgroundColor: watched ? colors.accent : 'transparent' }]}
      />
      <View style={styles.identity}>
        <Text
          style={[type.bodyStrong, { color: watched ? colors.accent : colors.text }]}
          numberOfLines={1}
        >
          {ticker.symbol}
        </Text>
      </View>
      {ranks.map((rank, i) => (
        <RankCell key={i} rank={rank} count={counts[i]} />
      ))}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: {
    height: RANK_ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: space(3),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  marker: {
    width: 3,
    height: 20,
    borderTopRightRadius: radius.sm,
    borderBottomRightRadius: radius.sm,
    marginRight: space(2.5),
  },
  identity: { flex: 1, justifyContent: 'center' },
  cell: { width: RANK_CELL_WIDTH, alignItems: 'center', justifyContent: 'center' },
  chip: {
    minWidth: 34,
    paddingVertical: 3,
    paddingHorizontal: space(1),
    borderRadius: radius.sm,
    alignItems: 'center',
  },
});
