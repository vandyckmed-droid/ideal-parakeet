import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PriceChart } from '../components/PriceChart';
import { SegmentedControl } from '../components/SegmentedControl';
import { formatDate } from '../data/market';
import { RESEARCH } from '../data/research';
import { useColors } from '../theme/ThemeProvider';
import { mono, radius, space, type } from '../theme/theme';

/**
 * $10,000 in the top-50 momentum portfolio against $10,000 held in SPY, with
 * every rule that produced the line stated on the same screen.
 *
 * Display only: the series is built by the nightly pipeline
 * (tools/05-build-research.mjs) with point-in-time index membership, so names
 * that later dropped out are in the months they were held. The app never
 * recomputes it.
 */

type WindowKey = '3M' | '6M' | '9M' | '1Y' | '3Y' | '5Y' | 'MAX';

const WINDOWS: { key: WindowKey; label: string; months: number | null; words: string }[] = [
  { key: '3M', label: '3M', months: 3, words: 'Trailing 3 months' },
  { key: '6M', label: '6M', months: 6, words: 'Trailing 6 months' },
  { key: '9M', label: '9M', months: 9, words: 'Trailing 9 months' },
  { key: '1Y', label: '1Y', months: 12, words: 'Trailing 1 year' },
  { key: '3Y', label: '3Y', months: 36, words: 'Trailing 3 years' },
  { key: '5Y', label: '5Y', months: 60, words: 'Trailing 5 years' },
  { key: 'MAX', label: 'Max', months: null, words: '' },
];

export function ResearchScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const [scrub, setScrub] = useState<number | null>(null);
  const [windowKey, setWindowKey] = useState<WindowKey>('MAX');

  const spec = WINDOWS.find((w) => w.key === windowKey) ?? WINDOWS[WINDOWS.length - 1];

  // Both lines are re-based to $10,000 at the start of the selected window, so
  // every window answers the same question: what would the two have done with
  // the same money over this stretch. Comparing a re-based line against an
  // absolute one would be a rigged race.
  const view = useMemo(() => {
    const { series, benchmarks, startValue } = RESEARCH;
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
    const dates = series.slice(start).map(([d]) => d);
    const values = series.slice(start).map(([, v]) => (v / pBase) * startValue);
    const refs = benchmarks.map((b) => {
      const bBase = b.values[start];
      return {
        symbol: b.symbol,
        name: b.name,
        values: b.values.slice(start).map((v) => (v / bBase) * startValue),
      };
    });
    return { dates, values, refs, truncated: spec.months != null && start === 0 };
  }, [spec]);

  const { dates, values, refs } = view;

  // Both references stay in neutral greys: up/down carry return sign
  // everywhere else in the app and must not be spent on a legend. They are
  // told apart by weight and dash rather than by hue.
  const refStyles = [
    { color: colors.textFaint, dash: '2 3' },
    { color: colors.textMuted, dash: '6 3' },
  ];
  const refStyle = (i: number) => refStyles[Math.min(i, refStyles.length - 1)];
  const i = scrub ?? values.length - 1;
  const date = dates[i];
  const value = values[i];
  const ret = value / RESEARCH.startValue - 1;
  const tone = ret >= 0 ? colors.up : colors.down;

  const rows = refs.map((r, n) => {
    const rv = r.values[i];
    const rr = rv / RESEARCH.startValue - 1;
    return { ...r, value: rv, ret: rr, gap: (ret - rr) * 100, style: refStyle(n) };
  });

  const latest = RESEARCH.formations[RESEARCH.formations.length - 1];

  // Read off the series rather than restated, so the rule cannot drift out of
  // step with the window the pipeline actually built.
  const inceptionLabel = new Date(`${RESEARCH.series[0][0]}T00:00:00`).toLocaleDateString(
    'en-US',
    { month: 'long', year: 'numeric' }
  );
  const periodRule =
    spec.months == null || view.truncated
      ? `Since ${inceptionLabel}, $${RESEARCH.startValue.toLocaleString()} at the start`
      : `${spec.words}, $${RESEARCH.startValue.toLocaleString()} at the window's start`;

  const money = (v: number) =>
    `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const pct = (v: number) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;

  const rules: [string, string][] = [
    ['Universe', 'S&P 500 members as of each measurement date (point in time - names later removed are included while they were members). The Market tab tracks the same index.'],
    ['Signal', '12-1 momentum: return from 12 months before the measurement date to 1 month before it'],
    ['Selection', `Top ${RESEARCH.top}, equally weighted`],
    ['Rebalance', 'Measured at the last trading day of each month, traded at the next trading day’s close, held untouched in between'],
    ['Period', periodRule],
    [
      'Benchmarks',
      `${refs.map((r) => `${r.symbol} (${r.name})`).join(' and ')}, each bought once at the same start and held. ` +
        'RSP is the like-for-like one: this portfolio is equally weighted too, so measuring it against a cap-weighted index would score the weighting scheme as well as the stock picking.',
    ],
    ['Dividends', 'Reinvested on every side, via adjusted closes'],
    ['Costs', 'No taxes or fees'],
    ['Delistings', 'A holding that stops trading is frozen at its last close until the next rebalance'],
  ];

  return (
    <View style={[styles.root, { backgroundColor: colors.bg, paddingTop: insets.top }]}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + space(8) }}>
        <View style={styles.header}>
          <Text style={[type.hero, { color: colors.text }]}>Research</Text>
          <Text style={[type.caption, { color: colors.textMuted }]}>
            Top-{RESEARCH.top} momentum vs {refs.map((r) => r.symbol).join(' and ')} · through{' '}
            {formatDate(RESEARCH.series[RESEARCH.series.length - 1][0])}
          </Text>
        </View>

        <View style={styles.figures}>
          <Text style={[type.hero, mono, { color: colors.text }]}>{money(value)}</Text>
          <Text style={[type.body, mono, { color: tone }]}>
            {pct(ret)} · {formatDate(date)}
          </Text>
        </View>

        <PriceChart
          values={values}
          compare={rows.map((r) => ({ values: r.values, ...r.style }))}
          height={240}
          onScrub={setScrub}
        />

        <View style={styles.picker}>
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

        <View style={styles.section}>
          <Text style={[type.micro, { color: colors.textFaint, marginBottom: space(2) }]}>
            HEAD TO HEAD
          </Text>
          <View style={[styles.card, { backgroundColor: colors.surface }]}>
            <View style={[styles.h2hRow, { borderBottomColor: colors.hairline }]}>
              <View style={[styles.swatch, { backgroundColor: tone }]} />
              <Text style={[type.caption, styles.h2hName, { color: colors.text }]}>
                Top-{RESEARCH.top} momentum
              </Text>
              <Text style={[type.caption, mono, styles.h2hMoney, { color: colors.text }]}>
                {money(value)}
              </Text>
              <Text style={[type.caption, mono, styles.h2hPct, { color: tone }]}>{pct(ret)}</Text>
            </View>
            {rows.map((r) => (
              <View
                key={r.symbol}
                style={[styles.h2hRow, { borderBottomColor: colors.hairline }]}
              >
                <View style={[styles.swatch, { backgroundColor: r.style.color }]} />
                <Text style={[type.caption, styles.h2hName, { color: colors.text }]}>
                  {r.symbol}, held
                </Text>
                <Text style={[type.caption, mono, styles.h2hMoney, { color: colors.text }]}>
                  {money(r.value)}
                </Text>
                <Text
                  style={[
                    type.caption,
                    mono,
                    styles.h2hPct,
                    { color: r.ret >= 0 ? colors.up : colors.down },
                  ]}
                >
                  {pct(r.ret)}
                </Text>
              </View>
            ))}
            {rows.map((r, n) => (
              <View
                key={`gap-${r.symbol}`}
                style={[
                  styles.h2hRow,
                  n === rows.length - 1 ? styles.h2hLast : { borderBottomColor: colors.hairline },
                ]}
              >
                <View style={styles.swatch} />
                <Text style={[type.caption, styles.h2hName, { color: colors.textMuted }]}>
                  vs {r.symbol}
                </Text>
                <Text style={[type.caption, mono, styles.h2hMoney, { color: colors.textMuted }]}>
                  {r.gap >= 0 ? '+' : '−'}
                  {money(Math.abs(value - r.value)).slice(1)}
                </Text>
                <Text
                  style={[
                    type.caption,
                    mono,
                    styles.h2hPct,
                    { color: r.gap >= 0 ? colors.up : colors.down },
                  ]}
                >
                  {r.gap >= 0 ? '+' : ''}
                  {r.gap.toFixed(1)} pts
                </Text>
              </View>
            ))}
          </View>
        </View>

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
  picker: { paddingHorizontal: space(4), marginTop: space(3) },
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
  h2hRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(2),
    paddingVertical: space(2.5),
    borderBottomWidth: StyleSheet.hairlineWidth,
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
