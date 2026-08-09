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
import { GroupBody, filterGroups } from './GroupScreen';
import { WindowPicker } from './WindowPicker';
import { OptionSheet } from './OptionSheet';
import { K_CHOICES, groupIndexFor, groupsForK, hasGrouping, ungroupedCount } from './groups';
import { SegmentedControl } from './ui';
import { useTheme } from './theme';
import { HORIZONS, horizonIndexForWindow } from './ranks';
import { formatDateShort, windowForPreset, withSkip } from './stats';

const VIEW_SEGMENTS = [
  { key: 'card', label: 'Card' },
  { key: 'table', label: 'Table' },
  { key: 'groups', label: 'Groups' },
];

export function MarketScreen({
  data, research, win, setPreset, setCustomWindow,
  metric, setMetric, skipEnabled, setSkipEnabled, sessionsStale,
  isWatched, toggleWatch, onOpenDetail, onOrder, overlap, overlapCaption, tab,
  familyCompare, familySlots, toggleFamilyCompare, onOpenFamily,
  groupCount, setGroupCount,
}) {
  const { colors } = useTheme();
  const { dates, tickers, sectors } = data;

  const [view, setView] = useState('card');
  const [query, setQuery] = useState('');
  const [sector, setSector] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  const [bestFirst, setBestFirst] = useState(true);

  const lastIndex = dates.length - 1;
  const range = useMemo(
    () => withSkip(win, skipEnabled, sessionsStale, lastIndex),
    [win, skipEnabled, sessionsStale, lastIndex]
  );

  const groups = useMemo(
    () => (view === 'groups' ? groupsForK(groupCount).groups : []),
    [view, groupCount]
  );
  // Only the table's standings need this, and building it means running the
  // clustering. Computed unconditionally it ran on the very first Market
  // render - before the card list had painted - so the app sat on the loading
  // screen for seconds while a view that does not use groups waited for them.
  // src/screens/RankTableScreen.tsx has always asked for it from inside the
  // table; this is that build's behaviour, restored.
  const groupIndex = useMemo(
    () => (view === 'table' ? groupIndexFor(groupCount) : null),
    [view, groupCount]
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
  const groupCountShown = useMemo(() => filterGroups(groups, query).length, [groups, query]);

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
    if (view === 'groups') {
      if (!hasGrouping()) return 'correlation matrix not published yet';
      const ungrouped = ungroupedCount() ? ` · ${ungroupedCount()} ungrouped` : '';
      return `${groupCountShown} of ${groupCount} groups${ungrouped} · ${through}${skipNote}`;
    }
    return `${stockCount} ${stockCount === 1 ? 'name' : 'names'} · ${through}${skipNote}`;
  }, [view, stockCount, groupCountShown, groupCount, tickers.length, dates, range, skipEnabled, sessionsStale, lastIndex]);

  // Groups are not a sector cut, so that view swaps the sector dropdown for
  // the control that actually governs it: how many groups to make.
  const sectorOptions = view === 'groups' ? [] : sectors;

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
        searchPlaceholder={
          view === 'groups' ? 'Search a group or its members' : 'Search symbol or company'
        }
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
        sector={view === 'groups' ? `${groupCount} groups` : sector}
        sectors={view === 'groups' ? ['groups'] : sectorOptions}
        onOpenSectorPicker={() => setSheetOpen(true)}
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
          famOf={groupIndex}
          isWatched={isWatched}
          toggleWatch={toggleWatch}
          onOpenDetail={onOpenDetail}
        />
      )}
      {view === 'groups' && (
        <GroupBody
          dates={dates}
          win={win}
          metric={metric}
          skipEnabled={skipEnabled}
          sessionsStale={sessionsStale}
          query={query}
          groupCount={groupCount}
          familyCompare={familyCompare}
          familySlots={familySlots}
          toggleFamilyCompare={toggleFamilyCompare}
          onOpenGroup={onOpenFamily}
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

      {view === 'groups' ? (
        <OptionSheet
          visible={sheetOpen}
          title="Groups"
          footnote={`Every group holds within ±20% of ${Math.round(
            groupsForK(groupCount).target
          )} names. Fewer groups means broader themes; more means tighter ones.`}
          options={K_CHOICES.map((k) => ({
            key: String(k),
            label: `${k} groups`,
            caption: `about ${Math.round((tickers.length - ungroupedCount()) / k)} names each`,
          }))}
          selected={String(groupCount)}
          onClose={() => setSheetOpen(false)}
          onSelect={(k) => setGroupCount(Number(k))}
        />
      ) : (
        <OptionSheet
          visible={sheetOpen}
          title="Sector"
          options={[{ key: '', label: 'All sectors' }].concat(
            sectors.map((x) => ({ key: x, label: x }))
          )}
          selected={sector || ''}
          onClose={() => setSheetOpen(false)}
          onSelect={(x) => setSector(x === '' ? null : x)}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
});
