import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PriceChart } from '../components/PriceChart';
import { formatDate } from '../data/market';
import { RESEARCH } from '../data/research';
import { useColors } from '../theme/ThemeProvider';
import { mono, radius, space, type } from '../theme/theme';

/**
 * $10,000 in the top-50 momentum portfolio over the previous four quarters,
 * with every rule that produced it stated on the same screen.
 *
 * Display only: the series is built by the nightly pipeline
 * (tools/05-build-research.mjs) with point-in-time index membership, so names
 * that later dropped out are in the months they were held. The app never
 * recomputes it.
 */
export function ResearchScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const [scrub, setScrub] = useState<number | null>(null);

  const series = RESEARCH.series;
  const values = useMemo(() => series.map(([, v]) => v), [series]);

  const i = scrub ?? series.length - 1;
  const [date, value] = series[i];
  const ret = value / RESEARCH.startValue - 1;
  const tone = ret >= 0 ? colors.up : colors.down;

  const latest = RESEARCH.formations[RESEARCH.formations.length - 1];

  // Read off the series rather than restated, so the rule cannot drift out of
  // step with the window the pipeline actually built.
  const startLabel = new Date(`${series[0][0]}T00:00:00`).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });

  const rules: [string, string][] = [
    ['Universe', 'S&P 500 members as of each measurement date (point in time - names later removed are included while they were members). The Market tab tracks the same index.'],
    ['Signal', '12-1 momentum: return from 12 months before the measurement date to 1 month before it'],
    ['Selection', `Top ${RESEARCH.top}, equally weighted`],
    ['Rebalance', 'Measured at the last trading day of each month, traded at the next trading day’s close, held untouched in between'],
    ['Period', `Since ${startLabel}, $${RESEARCH.startValue.toLocaleString()} at the start`],
    ['Dividends', 'Reinvested, via adjusted closes'],
    ['Costs', 'No taxes or fees'],
    ['Delistings', 'A holding that stops trading is frozen at its last close until the next rebalance'],
  ];

  return (
    <View style={[styles.root, { backgroundColor: colors.bg, paddingTop: insets.top }]}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + space(8) }}>
        <View style={styles.header}>
          <Text style={[type.hero, { color: colors.text }]}>Research</Text>
          <Text style={[type.caption, { color: colors.textMuted }]}>
            $10,000 in the top-{RESEARCH.top} momentum portfolio · through{' '}
            {formatDate(series[series.length - 1][0])}
          </Text>
        </View>

        <View style={styles.figures}>
          <Text style={[type.hero, mono, { color: colors.text }]}>
            ${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </Text>
          <Text style={[type.body, mono, { color: tone }]}>
            {ret >= 0 ? '+' : ''}
            {(ret * 100).toFixed(1)}% · {formatDate(date)}
          </Text>
        </View>

        <PriceChart values={values} height={240} onScrub={setScrub} />

        <View style={styles.section}>
          <Text style={[type.micro, { color: colors.textFaint, marginBottom: space(2) }]}>
            RULES
          </Text>
          <View style={[styles.card, { backgroundColor: colors.surface }]}>
            {rules.map(([label, text]) => (
              <View key={label} style={[styles.ruleRow, { borderBottomColor: colors.hairline }]}>
                <Text style={[type.caption, styles.ruleLabel, { color: colors.textMuted }]}>
                  {label}
                </Text>
                <Text style={[type.caption, styles.ruleText, { color: colors.text }]}>{text}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[type.micro, { color: colors.textFaint, marginBottom: space(2) }]}>
            CURRENT HOLDINGS · ENTERED {formatDate(latest.entered).toUpperCase()}
          </Text>
          <View style={[styles.card, { backgroundColor: colors.surface }]}>
            <Text style={[type.caption, mono, styles.holdings, { color: colors.text }]}>
              {latest.holdings.join('  ')}
            </Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: space(4), paddingTop: space(1), gap: 2 },
  figures: { paddingHorizontal: space(4), paddingTop: space(4), paddingBottom: space(2), gap: 2 },
  section: { paddingHorizontal: space(4), marginTop: space(6) },
  card: {
    borderRadius: radius.md,
    paddingHorizontal: space(3.5),
    paddingVertical: space(1),
  },
  ruleRow: {
    flexDirection: 'row',
    gap: space(3),
    paddingVertical: space(2.5),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  ruleLabel: { width: 84 },
  ruleText: { flex: 1 },
  holdings: { paddingVertical: space(2.5), lineHeight: 22 },
});
