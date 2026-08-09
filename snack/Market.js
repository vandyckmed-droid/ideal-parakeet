// Mirrors src/screens/MarketScreen.tsx - if these two ever disagree, the
// .tsx file is the one that is wrong.
//
// The Market tab: one screen, three bodies. Card, Table and Families used to
// be three separate screens that each built their own header, and switching
// between them moved every control a little. Now the screen owns one
// ListHeader and only the body below it changes, so the chrome is a fixed
// frame the views swap inside.
//
// The same move made the state shared instead of per-view: the search text,
// the sector filter survive a view switch, the window control
// drives the table's leading column (and tapping a column drives it back),
// and the family view is searchable like everything else.

import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ListHeader } from './chrome';
import { StockListBody, filterUniverse } from './ListScreen';
import { RankTableBody } from './RankTable';
import { FamilyBody, alignFamilies, familyBySymbol, filterFamilies } from './FamilyScreen';
import { WindowPicker } from './WindowPicker';
import { SectorPicker } from './SectorPicker';
import { SegmentedControl } from './ui';
import { useTheme } from './theme';
import { HORIZONS, horizonIndexForWindow } from './ranks';
import { formatDateShort, windowForPreset, withSkip } from './stats';

const VIEW_SEGMENTS = [
  { key: 'card', label: 'Card' },
  { key: 'table', label: 'Table' },
  { key: 'families', label: 'Families' },
];

export function MarketScreen({
  data, research, win, setPreset, setCustomWindow,
  metric, setMetric, skipEnabled, setSkipEnabled, sessionsStale,
  isWatched, toggleWatch, onOpenDetail, onOrder, overlap, overlapCaption, tab,
  familyCompare, familySlots, toggleFamilyCompare, onOpenFamily,
}) {
  const { colors } = useTheme();
  const { dates, tickers, sectors } = data;

  const [view, setView] = useState('card');
  const [query, setQuery] = useState('');
  const [sector, setSector] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sectorPickerOpen, setSectorPickerOpen] = useState(false);

  const [bestFirst, setBestFirst] = useState(true);

  const lastIndex = dates.length - 1;
  const range = useMemo(
    () => withSkip(win, skipEnabled, sessionsStale, lastIndex),
    [win, skipEnabled, sessionsStale, lastIndex]
  );

  const families = useMemo(() => alignFamilies(research, dates), [research, dates]);
  const famOf = useMemo(() => familyBySymbol(families), [families]);

  // The table's sorted column IS the shared window, resolved to the nearest
  // horizon; tapping a column that is already leading flips the direction,
  // tapping another moves the shared window there. One time axis everywhere.
  const sortColumn = useMemo(() => horizonIndexForWindow(win, dates), [win, dates]);
  const cycleColumn = useCallback(
    (column) => {
      if (column === sortColumn) setBestFirst((b) => !b);
      else {
        setPreset(HORIZONS[column].key);
        setBestFirst(true);
      }
    },
    [sortColumn, setPreset]
  );

  // Live row counts for the caption - the same predicates the bodies use.
  const stockCount = useMemo(
    () => filterUniverse(tickers, query, sector).length,
    [tickers, query, sector]
  );
  const familyCount = useMemo(
    () => filterFamilies(families, query).length,
    [families, query]
  );

  const caption = useMemo(() => {
    const through = `through ${formatDateShort(dates[range.endIndex])}`;
    const skipNote = range.skip > 0 ? ` · ${range.skip}d skipped` : '';
    if (view === 'table') {
      // Each horizon drops its own tail, so the note lists them all.
      const skips = HORIZONS.map(
        (h) => withSkip(windowForPreset(h.key, dates), skipEnabled, sessionsStale, lastIndex).skip
      );
      const names =
        stockCount === tickers.length
          ? `${tickers.length} names`
          : `${stockCount} of ${tickers.length} · ranks stay market-wide`;
      return `${names}${skipEnabled ? ` · skipping ${skips.join('/')}d` : ''}`;
    }
    if (view === 'families') {
      if (!families.length) return 'family series not published yet';
      return `${familyCount} ${familyCount === 1 ? 'family' : 'families'} · ${through}${skipNote}`;
    }
    return `${stockCount} ${stockCount === 1 ? 'name' : 'names'} · ${through}${skipNote}`;
  }, [view, stockCount, familyCount, families.length, tickers.length, dates, range, skipEnabled, sessionsStale, lastIndex]);

  // The family view has no sectors to filter by, so it gets no sector row at
  // all rather than a dropdown that would always say "All sectors."
  const sectorOptions = view === 'families' ? [] : sectors;

  const viewSwitch = (
    <SegmentedControl segments={VIEW_SEGMENTS} value={view} onChange={setView} compact />
  );

  return (
    <View style={[s.root, { backgroundColor: colors.bg }]}>
      <ListHeader
        title="Market"
        caption={caption}
        query={query}
        onQuery={setQuery}
        searchPlaceholder={view === 'families' ? 'Search families' : 'Search symbol or company'}
        accessory={viewSwitch}
        win={win}
        onPreset={setPreset}
        onOpenPicker={() => setPickerOpen(true)}
        metric={metric}
        onMetric={setMetric}
        skipEnabled={skipEnabled}
        onToggleSkip={() => setSkipEnabled(!skipEnabled)}
        range={range}
        sessionsStale={sessionsStale}
        dates={dates}
        sector={sector}
        sectors={sectorOptions}
        onOpenSectorPicker={() => setSectorPickerOpen(true)}
      />

      {view === 'card' && (
        <StockListBody
          universe={tickers}
          dates={dates}
          win={win}
          metric={metric}
          skipEnabled={skipEnabled}
          sessionsStale={sessionsStale}
          query={query}
          sector={sector}
          overlap={overlap}
          overlapCaption={overlapCaption}
          showGestureHint
          isWatched={isWatched}
          toggleWatch={toggleWatch}
          onOpenDetail={onOpenDetail}
          onOrder={onOrder}
        />
      )}
      {view === 'table' && (
        <RankTableBody
          universe={tickers}
          dates={dates}
          metric={metric}
          skipEnabled={skipEnabled}
          sessionsStale={sessionsStale}
          query={query}
          sector={sector}
          sortColumn={sortColumn}
          bestFirst={bestFirst}
          onCycleSort={cycleColumn}
          famOf={famOf}
          isWatched={isWatched}
          toggleWatch={toggleWatch}
          onOpenDetail={onOpenDetail}
        />
      )}
      {view === 'families' && (
        <FamilyBody
          families={families}
          dates={dates}
          win={win}
          metric={metric}
          skipEnabled={skipEnabled}
          sessionsStale={sessionsStale}
          query={query}
          familyCompare={familyCompare}
          familySlots={familySlots}
          toggleFamilyCompare={toggleFamilyCompare}
          onOpenFamily={onOpenFamily}
        />
      )}

      {tab}

      <WindowPicker
        visible={pickerOpen}
        window={win}
        dates={dates}
        onClose={() => setPickerOpen(false)}
        onApply={setCustomWindow}
      />

      <SectorPicker
        visible={sectorPickerOpen}
        sectors={sectorOptions}
        sector={sector}
        onClose={() => setSectorPickerOpen(false)}
        onSelect={setSector}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
});
