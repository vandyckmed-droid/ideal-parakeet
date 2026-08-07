import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { WindowStats, formatPercentPlain, formatRatio } from '../data/stats';
import { useColors } from '../theme/ThemeProvider';
import { mono, radius, space, type } from '../theme/theme';
import { InfoButton } from './InfoButton';

type Props = {
  stats: WindowStats | null;
  diversificationRatio: number | null;
};

const DIVERSIFICATION_EXPLANATION =
  'The average volatility of your holdings on their own, divided by your ' +
  "portfolio's actual volatility. 1.0x means combining these names bought " +
  'you nothing - your risk is the same as just holding one of them. 2.0x ' +
  'means your combined risk is half what the average holding carries alone. ' +
  'Higher is more diversified.';

function formatDiversification(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return '—';
  return `${v.toFixed(2)}x`;
}

/**
 * The watchlist's own volatility, risk-adjusted return and diversification
 * ratio, treated as one equal-weighted position rather than N separate rows.
 * `stats` already reflects whatever window and skip setting the rest of the
 * screen is using, computed by TickerListScreen via the same
 * `computeWindowStats` every individual row uses (with the vol floor turned
 * off - see src/data/stats.ts) - this component only renders.
 *
 * Deliberately does not show the portfolio's total return. A watchlist is
 * assembled by reading a list ranked on past return and keeping the names
 * near the top, so its backtested return is close to a tautology: it measures
 * the selection, not a result anyone could have had. The risk figures do not
 * have that problem - nothing here was chosen for being low-volatility or
 * uncorrelated, so sigma and the diversification ratio describe the basket
 * rather than restating how it was picked.
 */
export const PortfolioSummary = React.memo(function PortfolioSummary({
  stats,
  diversificationRatio,
}: Props) {
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

  return (
    <View
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
      accessibilityLabel={
        `Portfolio, equal-weighted: ` +
        `volatility ${formatPercentPlain(stats.annualizedVol)}, ` +
        `return over volatility ${formatRatio(stats.ratio)}, ` +
        `diversification ${formatDiversification(diversificationRatio)}`
      }
    >
      <Text style={[type.micro, { color: colors.textFaint }]}>PORTFOLIO · EQUAL-WEIGHTED</Text>

      <View style={styles.figures}>
        <View style={styles.figure}>
          <Text style={[type.micro, { color: colors.textFaint }]}>ANN σ</Text>
          <Text style={[type.heading, mono, { color: colors.textMuted }]}>
            {formatPercentPlain(stats.annualizedVol)}
          </Text>
        </View>
        <View style={styles.figure}>
          <Text style={[type.micro, { color: colors.textFaint }]}>RETURN ÷ σ</Text>
          <Text style={[type.heading, mono, { color: colors.text }]}>
            {formatRatio(stats.ratio)}
          </Text>
        </View>
      </View>

      <View style={[styles.divider, { backgroundColor: colors.hairline }]} />

      <View style={styles.diversificationRow}>
        <View style={styles.diversificationLabel}>
          <Text style={[type.micro, { color: colors.textFaint }]}>DIVERSIFICATION</Text>
          <InfoButton title="Diversification ratio">{DIVERSIFICATION_EXPLANATION}</InfoButton>
        </View>
        <Text style={[type.heading, mono, { color: colors.text }]}>
          {formatDiversification(diversificationRatio)}
        </Text>
      </View>
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
  divider: { height: StyleSheet.hairlineWidth, marginVertical: space(2) },
  diversificationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  diversificationLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(1.5),
  },
});
