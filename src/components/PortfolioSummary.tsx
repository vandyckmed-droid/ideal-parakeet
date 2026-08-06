import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { WindowStats, formatPercent, formatPercentPlain, formatRatio } from '../data/stats';
import { useColors } from '../theme/ThemeProvider';
import { mono, radius, space, type } from '../theme/theme';

type Props = {
  stats: WindowStats | null;
};

/**
 * The watchlist's own return, volatility and risk-adjusted return, treated as
 * one equal-weighted position rather than N separate rows. `stats` already
 * reflects whatever window and skip setting the rest of the screen is using,
 * computed by TickerListScreen via the same `computeWindowStats` every
 * individual row uses - this component only renders.
 */
export const PortfolioSummary = React.memo(function PortfolioSummary({ stats }: Props) {
  const colors = useColors();

  if (!stats) {
    return (
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[type.micro, { color: colors.textFaint }]}>
          PORTFOLIO · EQUAL-WEIGHTED
        </Text>
        <Text style={[type.caption, { color: colors.textFaint, marginTop: space(1) }]}>
          Not enough shared history in this window.
        </Text>
      </View>
    );
  }

  const tone = stats.totalReturn >= 0 ? colors.up : colors.down;

  return (
    <View
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
      accessibilityLabel={
        `Portfolio, equal-weighted: return ${formatPercent(stats.totalReturn)}, ` +
        `volatility ${formatPercentPlain(stats.annualizedVol)}, ` +
        `return over volatility ${formatRatio(stats.ratio)}`
      }
    >
      <Text style={[type.micro, { color: colors.textFaint }]}>PORTFOLIO · EQUAL-WEIGHTED</Text>

      <View style={styles.figures}>
        <View style={styles.figure}>
          <Text style={[type.micro, { color: colors.textFaint }]}>RETURN</Text>
          <Text style={[type.heading, mono, { color: tone }]}>
            {formatPercent(stats.totalReturn)}
          </Text>
        </View>
        <View style={styles.figure}>
          <Text style={[type.micro, { color: colors.textFaint }]}>ANN σ</Text>
          <Text style={[type.heading, mono, { color: colors.textMuted }]}>
            {formatPercentPlain(stats.annualizedVol)}
            {stats.volFloored ? '*' : ''}
          </Text>
        </View>
        <View style={styles.figure}>
          <Text style={[type.micro, { color: colors.textFaint }]}>RETURN ÷ σ</Text>
          <Text style={[type.heading, mono, { color: colors.text }]}>
            {formatRatio(stats.ratio)}
          </Text>
        </View>
      </View>

      {stats.volFloored && (
        <Text style={[type.caption, { color: colors.textFaint, marginTop: space(1) }]}>
          * σ is held at the 12.5% floor applied to the ratio's divisor.
        </Text>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space(4),
    paddingVertical: space(3),
    gap: space(1),
  },
  figures: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: space(1),
  },
  figure: { gap: 2 },
});
