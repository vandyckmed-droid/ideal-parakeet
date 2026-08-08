// Mirrors src/screens/ResearchScreen.tsx - if these two ever disagree, the
// .tsx file is the one that is wrong.

import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { PriceChart, SegmentedControl } from './ui';
import { useColors, radius, space, type, mono } from './theme';
import { formatDate } from './stats';

const WINDOWS = [
  { key: '3M', label: '3M', months: 3, words: 'Trailing 3 months' },
  { key: '6M', label: '6M', months: 6, words: 'Trailing 6 months' },
  { key: '9M', label: '9M', months: 9, words: 'Trailing 9 months' },
  { key: '1Y', label: '1Y', months: 12, words: 'Trailing 1 year' },
  { key: '3Y', label: '3Y', months: 36, words: 'Trailing 3 years' },
  { key: '5Y', label: '5Y', months: 60, words: 'Trailing 5 years' },
  { key: 'MAX', label: 'Max', months: null, words: '' },
];

export function ResearchScreen({ research }) {
  const colors = useColors();
  const [scrub, setScrub] = useState(null);
  const [windowKey, setWindowKey] = useState('MAX');

  const spec = WINDOWS.find((w) => w.key === windowKey) || WINDOWS[WINDOWS.length - 1];

  // Both lines are re-based to $10,000 at the start of the selected window, so
  // every window answers the same question: what would the two have done with
  // the same money over this stretch. Comparing a re-based line against an
  // absolute one would be a rigged race.
  const view = useMemo(() => {
    if (!research) return null;
    const { series, benchmark, startValue } = research;
    let start = 0;
    if (spec.months != null) {
      const last = new Date(`${series[series.length - 1][0]}T00:00:00`);
      const cutoff = new Date(last);
      cutoff.setMonth(cutoff.getMonth() - spec.months);
      const iso = cutoff.toISOString().slice(0, 10);
      const found = series.findIndex(([d]) => d >= iso);
      // A window longer than the data simply shows all of it.
      start = found <= 0 ? 0 : found;
    }
    // Two points are the minimum a line can be drawn from.
    if (start > series.length - 2) start = Math.max(0, series.length - 2);

    const pBase = series[start][1];
    const bBase = benchmark[start];
    return {
      dates: series.slice(start).map(([d]) => d),
      values: series.slice(start).map(([, v]) => (v / pBase) * startValue),
      compare: benchmark.slice(start).map((v) => (v / bBase) * startValue),
      truncated: spec.months != null && start === 0,
    };
  }, [research, spec]);

  if (!research || !view) {
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

  const { dates, values, compare } = view;
  const i = scrub == null ? values.length - 1 : scrub;
  const date = dates[i];
  const value = values[i];
  const benchValue = compare[i];
  const ret = value / research.startValue - 1;
  const benchRet = benchValue / research.startValue - 1;
  const gap = (ret - benchRet) * 100;
  const tone = ret >= 0 ? colors.up : colors.down;
  const latest = research.formations[research.formations.length - 1];

  const inceptionLabel = new Date(`${research.series[0][0]}T00:00:00`).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });
  const periodRule =
    spec.months == null || view.truncated
      ? `Since ${inceptionLabel}, $${research.startValue.toLocaleString()} at the start`
      : `${spec.words}, $${research.startValue.toLocaleString()} at the window's start`;

  const money = (v) =>
    `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const pct = (v) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;

  const rules = [
    ['Universe', 'S&P 500 members as of each measurement date (point in time - names later removed are included while they were members). The Market tab tracks the same index.'],
    ['Signal', '12-1 momentum: return from 12 months before the measurement date to 1 month before it'],
    ['Selection', `Top ${research.top}, equally weighted`],
    ['Rebalance', 'Measured at the last trading day of each month, traded at the next trading day’s close, held untouched in between'],
    ['Period', periodRule],
    ['Benchmark', `${research.benchmarkSymbol} bought once at the same start and held - ${research.benchmarkName}`],
    ['Dividends', 'Reinvested on both sides, via adjusted closes'],
    ['Costs', 'No taxes or fees'],
    ['Delistings', 'A holding that stops trading is frozen at its last close until the next rebalance'],
  ];

  return (
    <View style={[s.root, { backgroundColor: colors.bg }]}>
      <ScrollView contentContainerStyle={{ paddingBottom: space(8) }}>
        <View style={s.header}>
          <Text style={[type.hero, { color: colors.text }]}>Research</Text>
          <Text style={[type.caption, { color: colors.textMuted }]}>
            Top-{research.top} momentum vs {research.benchmarkSymbol} · through{' '}
            {formatDate(research.series[research.series.length - 1][0])}
          </Text>
        </View>

        <View style={s.figures}>
          <Text style={[type.hero, mono, { color: colors.text }]}>{money(value)}</Text>
          <Text style={[type.body, mono, { color: tone }]}>
            {pct(ret)} · {formatDate(date)}
          </Text>
        </View>

        <PriceChart values={values} compare={compare} height={240} onScrub={setScrub} />

        <View style={s.picker}>
          <SegmentedControl
            segments={WINDOWS.map((w) => ({ key: w.key, label: w.label }))}
            value={windowKey}
            onChange={(k) => {
              setScrub(null);
              setWindowKey(k);
            }}
            compact
          />
        </View>

        <View style={s.section}>
          <Text style={[type.micro, { color: colors.textFaint, marginBottom: space(2) }]}>
            HEAD TO HEAD
          </Text>
          <View style={[s.card, { backgroundColor: colors.surface }]}>
            <View style={[s.h2hRow, { borderBottomColor: colors.hairline }]}>
              <View style={[s.swatch, { backgroundColor: tone }]} />
              <Text style={[type.caption, s.h2hName, { color: colors.text }]}>
                Top-{research.top} momentum
              </Text>
              <Text style={[type.caption, mono, s.h2hMoney, { color: colors.text }]}>
                {money(value)}
              </Text>
              <Text style={[type.caption, mono, s.h2hPct, { color: tone }]}>{pct(ret)}</Text>
            </View>
            <View style={[s.h2hRow, { borderBottomColor: colors.hairline }]}>
              <View style={[s.swatch, { backgroundColor: colors.textMuted }]} />
              <Text style={[type.caption, s.h2hName, { color: colors.text }]}>
                {research.benchmarkSymbol}, held
              </Text>
              <Text style={[type.caption, mono, s.h2hMoney, { color: colors.text }]}>
                {money(benchValue)}
              </Text>
              <Text
                style={[
                  type.caption,
                  mono,
                  s.h2hPct,
                  { color: benchRet >= 0 ? colors.up : colors.down },
                ]}
              >
                {pct(benchRet)}
              </Text>
            </View>
            <View style={[s.h2hRow, s.h2hLast]}>
              <View style={s.swatch} />
              <Text style={[type.caption, s.h2hName, { color: colors.textMuted }]}>Difference</Text>
              <Text style={[type.caption, mono, s.h2hMoney, { color: colors.textMuted }]}>
                {gap >= 0 ? '+' : '−'}
                {money(Math.abs(value - benchValue)).slice(1)}
              </Text>
              <Text
                style={[type.caption, mono, s.h2hPct, { color: gap >= 0 ? colors.up : colors.down }]}
              >
                {gap >= 0 ? '+' : ''}
                {gap.toFixed(1)} pts
              </Text>
            </View>
          </View>
        </View>

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
  picker: { paddingHorizontal: space(4), marginTop: space(3) },
  section: { paddingHorizontal: space(4), marginTop: space(6) },
  card: { borderRadius: radius.md, paddingHorizontal: space(3.5), paddingVertical: space(1) },
  ruleRow: {
    flexDirection: 'row', gap: space(3), paddingVertical: space(2.5),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  ruleLabel: { width: 84 },
  ruleText: { flex: 1 },
  h2hRow: {
    flexDirection: 'row', alignItems: 'center', gap: space(2),
    paddingVertical: space(2.5), borderBottomWidth: StyleSheet.hairlineWidth,
  },
  // The closing row draws no rule; without this it inherits the default
  // border colour, which is black rather than the hairline tint.
  h2hLast: { borderBottomWidth: 0 },
  swatch: { width: 8, height: 8, borderRadius: 4 },
  h2hName: { flex: 1 },
  h2hMoney: { textAlign: 'right', minWidth: 92 },
  h2hPct: { textAlign: 'right', minWidth: 62 },
  holdings: { paddingVertical: space(2.5), lineHeight: 22 },
});
