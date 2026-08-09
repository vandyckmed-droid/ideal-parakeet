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
// the sector filter and the sort survive a view switch, the window control
// drives the table's leading column (and tapping a column drives it back),
// and the family view is searchable and sortable like everything else.

import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ListHeader } from './chrome';
import { StockListBody, filterUniverse } from './ListScreen';
import { RankTableBody } from './RankTable';
import { FamilyBody, alignFamilies, filterFamilies } from './FamilyScreen';
import { WindowPicker } from './WindowPicker';
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
}) {
  const { colors } = useTheme();
  const { dates, tickers, sectors } = data;

  const [view, setView] = useState('card');
  const [query, setQuery] = useState('');
  const [sector, setSector] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Per-view sort state, kept here rather than in the bodies so it survives
  // switching views and can drive the header's chips.
  const [sortKey, setSortKey] = useState('metric');
  const [descending, setDescending] = useState(true);
  const [famSort, setFamSort] = useState('metric');
  const [famDescending, setFamDescending] = useState(true);
  const [bestFirst, setBestFirst] = useState(true);
  // Null until first touched: the default depends on the research payload,
  // which arrives after mount.
  const [famSelected, setFamSelected] = useState(null);

  const lastIndex = dates.length - 1;
  const range = useMemo(
    () => withSkip(win, skipEnabled, sessionsStale, lastIndex),
    [win, skipEnabled, sessionsStale, lastIndex]
  );

  const families = useMemo(() => alignFamilies(research, dates), [research, dates]);
  const selected = famSelected || families.slice(0, 2).map((f) => f.s);

  const toggleFamily = useCallback(
    (key) => {
      setFamSelected(() => {
        const prev = selected;
        if (prev.includes(key)) return prev.length > 1 ? prev.filter((k) => k !== key) : prev;
        const next = [...prev, key];
        return next.length > 4 ? next.slice(1) : next;
      });
    },
    [selected]
  );

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

  // Chip rail per view. Sorts lead, sectors follow; families have no sectors
  // to filter, and the table sorts by its own columns.
  const chipGroups = useMemo(() => {
    const sectorChips = [null].concat(sectors).map((sec) => ({
      key: sec || 'all',
      label: sec || 'All sectors',
      active: sector === sec,
      onPress: () => setSector(sec),
    }));

    const metricLabel =
      metric === 'return' ? 'Return' : metric === 'residual' ? 'Residual' : 'Ratio';
    const arrow = (active, desc) => (active ? (desc ? ' ↓' : ' ↑') : '');

    if (view === 'card') {
      const cycle = (key) => {
        if (sortKey === key) setDescending((d) => !d);
        else {
          setSortKey(key);
          // Overlap's useful direction is ascending, same as Symbol: lowest
          // correlation first, so the top of the list is whichever name would
          // add the most diversification.
          setDescending(key !== 'symbol' && key !== 'overlap');
        }
      };
      const sortChips = [
        // The chip names whatever the metric control is set to, so the sort
        // and its label can never describe different columns.
        { key: 'metric', label: `${metricLabel}${arrow(sortKey === 'metric', descending)}` },
        { key: 'cap', label: `Size${arrow(sortKey === 'cap', descending)}` },
        { key: 'symbol', label: `A–Z${arrow(sortKey === 'symbol', descending)}` },
        // Only offered once the basket itself qualifies for a score: with too
        // few names every score is null, and a sort with nothing to rank by
        // is a control that does nothing.
        ...(overlap && overlap.reason === 'ok'
          ? [{ key: 'overlap', label: `Overlap${arrow(sortKey === 'overlap', descending)}` }]
          : []),
      ].map((c) => ({ ...c, active: sortKey === c.key, onPress: () => cycle(c.key) }));
      return [sortChips, sectorChips];
    }

    if (view === 'families') {
      const cycle = (key) => {
        if (famSort === key) setFamDescending((d) => !d);
        else {
          setFamSort(key);
          setFamDescending(key !== 'name');
        }
      };
      const famChips = [
        { key: 'metric', label: `${metricLabel}${arrow(famSort === 'metric', famDescending)}` },
        { key: 'size', label: `Size${arrow(famSort === 'size', famDescending)}` },
        { key: 'name', label: `A–Z${arrow(famSort === 'name', famDescending)}` },
      ].map((c) => ({ ...c, active: famSort === c.key, onPress: () => cycle(c.key) }));
      return [famChips];
    }

    return [sectorChips];
  }, [view, sector, sectors, metric, sortKey, descending, famSort, famDescending, overlap]);

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
        chipGroups={chipGroups}
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
          sortKey={sortKey}
          descending={descending}
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
          sortKey={famSort}
          descending={famDescending}
          selected={selected}
          onToggle={toggleFamily}
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
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
});
