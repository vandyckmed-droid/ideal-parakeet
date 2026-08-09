import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ListHeader } from '../components/ListHeader';
import { SectorPicker } from '../components/SectorPicker';
import { StockListBody } from '../components/StockListBody';
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
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sectorPickerOpen, setSectorPickerOpen] = useState(false);

  const range = useMemo(
    () => withSkip(win, skipEnabled, sessionsStale),
    [win, skipEnabled, sessionsStale]
  );

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
        sector={sector}
        sectors={SECTORS}
        onOpenSectorPicker={() => setSectorPickerOpen(true)}
      />

      <StockListBody
        universe={universe}
        query={query}
        sector={sector}
        overlap={overlap}
        emptyState={emptyState}
      />

      <WindowPicker
        visible={pickerOpen}
        window={win}
        onClose={() => setPickerOpen(false)}
        onApply={setCustomWindow}
      />

      <SectorPicker
        visible={sectorPickerOpen}
        sectors={SECTORS}
        sector={sector}
        onClose={() => setSectorPickerOpen(false)}
        onSelect={setSector}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
