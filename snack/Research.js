// Mirrors src/screens/ResearchScreen.tsx - if these two ever disagree, the
// .tsx file is the one that is wrong.

import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { PriceChart } from './ui';
import { useColors, radius, space, type, mono } from './theme';
import { formatDate } from './stats';

export function ResearchScreen({ research }) {
  const colors = useColors();
  const [scrub, setScrub] = useState(null);

  if (!research) {
    return (
      <View style={[s.root, s.centre, { backgroundColor: colors.bg }]}>
        <Text style={[type.title, { color: colors.text }]}>Research</Text>
        <Text style={[type.body, s.centreText, { color: colors.textMuted }]}>
          The research series hasn’t been published yet. It arrives with the
          next data update.
        </Text>
      </View>
    );
  }

  const series = research.series;
  const values = series.map(([, v]) => v);
  const i = scrub == null ? series.length - 1 : scrub;
  const [date, value] = series[i];
  const ret = value / research.startValue - 1;
  const tone = ret >= 0 ? colors.up : colors.down;
  const latest = research.formations[research.formations.length - 1];

  const rules = [
    ['Universe', 'S&P 500 members as of each measurement date (point in time - names later removed are included while they were members)'],
    ['Signal', '12-1 momentum: return from 12 months before the measurement date to 1 month before it'],
    ['Selection', `Top ${research.top}, equally weighted`],
    ['Rebalance', 'Measured at the last trading day of each month, traded at the next trading day’s close, held untouched in between'],
    ['Period', `Previous four quarters, $${research.startValue.toLocaleString()} at the start`],
    ['Dividends', 'Reinvested, via adjusted closes'],
    ['Costs', 'No taxes or fees'],
    ['Delistings', 'A holding that stops trading is frozen at its last close until the next rebalance'],
  ];

  return (
    <View style={[s.root, { backgroundColor: colors.bg }]}>
      <ScrollView contentContainerStyle={{ paddingBottom: space(8) }}>
        <View style={s.header}>
          <Text style={[type.hero, { color: colors.text }]}>Research</Text>
          <Text style={[type.caption, { color: colors.textMuted }]}>
            $10,000 in the top-{research.top} momentum portfolio · through{' '}
            {formatDate(series[series.length - 1][0])}
          </Text>
        </View>

        <View style={s.figures}>
          <Text style={[type.hero, mono, { color: colors.text }]}>
            ${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </Text>
          <Text style={[type.body, mono, { color: tone }]}>
            {ret >= 0 ? '+' : ''}
            {(ret * 100).toFixed(1)}% · {formatDate(date)}
          </Text>
        </View>

        <PriceChart values={values} height={240} onScrub={setScrub} />

        <View style={s.section}>
          <Text style={[type.micro, { color: colors.textFaint, marginBottom: space(2) }]}>RULES</Text>
          <View style={[s.card, { backgroundColor: colors.surface }]}>
            {rules.map(([label, text]) => (
              <View key={label} style={[s.ruleRow, { borderBottomColor: colors.hairline }]}>
                <Text style={[type.caption, s.ruleLabel, { color: colors.textMuted }]}>{label}</Text>
                <Text style={[type.caption, s.ruleText, { color: colors.text }]}>{text}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={s.section}>
          <Text style={[type.micro, { color: colors.textFaint, marginBottom: space(2) }]}>
            CURRENT HOLDINGS · ENTERED {formatDate(latest.entered).toUpperCase()}
          </Text>
          <View style={[s.card, { backgroundColor: colors.surface }]}>
            <Text style={[type.caption, mono, s.holdings, { color: colors.text }]}>
              {latest.holdings.join('  ')}
            </Text>
          </View>
        </View>

        <Text style={[type.caption, s.caveat, { color: colors.textFaint }]}>
          A backtest of stated rules, not a forecast. Selecting on past returns
          guarantees the past looks good; it promises nothing about the future.
        </Text>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  centre: { alignItems: 'center', justifyContent: 'center', gap: space(2), padding: space(8) },
  centreText: { textAlign: 'center', maxWidth: 300 },
  header: { paddingHorizontal: space(4), paddingTop: space(1), gap: 2 },
  figures: { paddingHorizontal: space(4), paddingTop: space(4), paddingBottom: space(2), gap: 2 },
  section: { paddingHorizontal: space(4), marginTop: space(6) },
  card: { borderRadius: radius.md, paddingHorizontal: space(3.5), paddingVertical: space(1) },
  ruleRow: {
    flexDirection: 'row', gap: space(3), paddingVertical: space(2.5),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  ruleLabel: { width: 84 },
  ruleText: { flex: 1 },
  holdings: { paddingVertical: space(2.5), lineHeight: 22 },
  caveat: { paddingHorizontal: space(4), marginTop: space(6), textAlign: 'center' },
});
