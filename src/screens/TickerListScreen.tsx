import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Chip, ListHeader } from '../components/ListHeader';
import { StockListBody, StockSortKey } from '../components/StockListBody';
import { WindowPicker } from '../components/WindowPicker';
import { SECTORS, Ticker } from '../data/market';
import { OverlapSummary } from '../data/overlap';
import { withSkip } from '../data/windows';
import { useAppState } from '../state/AppState';
import { useColors } from '../theme/ThemeProvider';

/**
 * A stock list under the standard header - today that means the Watchlist.
 * The Market tab composes the same ListHeader and StockListBody itself (it
 * has three bodies to swap under one header); this screen is the
 * single-body case.
 *
 * No caption between the title and the search box, deliberately: the numbers
 * that belong to a name belong on that name's row.
 */
export function TickerListScreen({
  title,
  universe,
  overlap,
  emptyState,
}: {
  title: string;
  universe: Ticker[];
  /** Drives the row badges and the Overlap sort for this screen's members. */
  overlap?: OverlapSummary;
  emptyState?: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const {
    window: win, setPreset, setCustomWindow,
    metric, setMetric, skipEnabled, setSkipEnabled, sessionsStale,
  } = useAppState();

  const [query, setQuery] = useState('');
  const [sector, setSector] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<StockSortKey>('metric');
  const [descending, setDescending] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);

  const range = useMemo(
    () => withSkip(win, skipEnabled, sessionsStale),
    [win, skipEnabled, sessionsStale]
  );

  const chipGroups = useMemo((): Chip[][] => {
    const cycle = (key: StockSortKey) => {
      if (sortKey === key) {
        setDescending((d) => !d);
      } else {
        setSortKey(key);
        // Overlap's useful direction is ascending, same as Symbol: lowest
        // correlation to the rest of the list first, so the top of the list
        // is whichever name would add the most diversification.
        setDescending(key !== 'symbol' && key !== 'overlap');
      }
    };
    const arrow = (active: boolean) => (active ? (descending ? ' ↓' : ' ↑') : '');
    const metricLabel =
      metric === 'return' ? 'Return' : metric === 'residual' ? 'Residual' : 'Ratio';
    const sortChips: Chip[] = [
      { key: 'metric', label: `${metricLabel}${arrow(sortKey === 'metric')}` },
      { key: 'cap', label: `Size${arrow(sortKey === 'cap')}` },
      { key: 'symbol', label: `A–Z${arrow(sortKey === 'symbol')}` },
      ...(overlap && overlap.reason === 'ok'
        ? [{ key: 'overlap', label: `Overlap${arrow(sortKey === 'overlap')}` }]
        : []),
    ].map((c) => ({
      ...c,
      active: sortKey === c.key,
      onPress: () => cycle(c.key as StockSortKey),
    }));
    const sectorChips: Chip[] = [null, ...SECTORS].map((s) => ({
      key: s ?? 'all',
      label: s ?? 'All sectors',
      active: sector === s,
      onPress: () => setSector(s),
    }));
    return [sortChips, sectorChips];
  }, [sortKey, descending, metric, overlap, sector]);

  return (
    <View style={[styles.root, { backgroundColor: colors.bg, paddingTop: insets.top }]}>
      <ListHeader
        title={title}
        query={query}
        onQuery={setQuery}
        win={win}
        onPreset={setPreset}
        onOpenPicker={() => setPickerOpen(true)}
        metric={metric}
        onMetric={setMetric}
        skipEnabled={skipEnabled}
        onToggleSkip={() => setSkipEnabled(!skipEnabled)}
        range={range}
        sessionsStale={sessionsStale}
        chipGroups={chipGroups}
      />

      <StockListBody
        universe={universe}
        query={query}
        sector={sector}
        sortKey={sortKey}
        descending={descending}
        overlap={overlap}
        emptyState={emptyState}
      />

      <WindowPicker
        visible={pickerOpen}
        window={win}
        onClose={() => setPickerOpen(false)}
        onApply={setCustomWindow}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
