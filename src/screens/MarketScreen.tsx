import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ListHeader } from '../components/ListHeader';
import { OptionSheet } from '../components/OptionSheet';
import { SegmentedControl } from '../components/SegmentedControl';
import { StockListBody, filterUniverse } from '../components/StockListBody';
import { WindowPicker } from '../components/WindowPicker';
import {
  GROUPING_AVAILABLE, K_CHOICES, UNGROUPED_COUNT, groupsForK,
} from '../data/groups';
import { BY_SYMBOL, DATES, SECTORS, TICKERS, Ticker, formatDateShort } from '../data/market';
import { computeOverlap, describeCandidateOverlap } from '../data/overlap';
import { HORIZONS, horizonIndexForWindow } from '../data/ranks';
import { windowForPreset, withSkip } from '../data/windows';
import { useAppState } from '../state/AppState';
import { useColors } from '../theme/ThemeProvider';
import { GroupBody, filterGroups } from './GroupListScreen';
import { RankTableBody } from './RankTableScreen';

type MarketView = 'card' | 'table' | 'groups';

const VIEW_SEGMENTS: { key: MarketView; label: string }[] = [
  { key: 'card', label: 'Card' },
  { key: 'table', label: 'Table' },
  { key: 'groups', label: 'Groups' },
];

/**
 * The Market tab: one screen, three bodies.
 *
 * Card, Table and Groups used to be three separate screens that each built
 * their own header, and switching between them moved every control a little -
 * the view switch hopped rows, the window row appeared and vanished, even the
 * theme button changed size. Now the screen owns one ListHeader and only the
 * body below it changes, so the chrome is a fixed frame the views swap inside.
 *
 * The same move made the state shared instead of per-view: the search text,
 * the sector filter and the sort survive a view switch, the window control
 * drives the table's leading column (and tapping a column drives it back),
 * and the groups view is searchable like everything else. All of
 * it is local rather than persisted - the screen stays mounted for the life
 * of the session, which is the only continuity a glance needs.
 */
export function MarketScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const {
    watchlist, window: win, setPreset, setCustomWindow,
    metric, setMetric, skipEnabled, setSkipEnabled, sessionsStale,
    groupCount, setGroupCount,
  } = useAppState();

  const [view, setView] = useState<MarketView>('card');
  const [query, setQuery] = useState('');
  const [sector, setSector] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  const [bestFirst, setBestFirst] = useState(true);

  const range = useMemo(
    () => withSkip(win, skipEnabled, sessionsStale),
    [win, skipEnabled, sessionsStale]
  );

  const basket = useMemo(
    () => watchlist.map((s) => BY_SYMBOL.get(s)).filter((t): t is Ticker => Boolean(t)),
    [watchlist]
  );

  // Screens the full 500 against the current watchlist: a badge here means
  // "adding this wouldn't diversify anything," whether or not it's already
  // held. See src/data/overlap.ts for why a name outside the basket is scored
  // differently from one inside it.
  const overlap = useMemo(
    () => computeOverlap(basket, TICKERS, win.startIndex, win.endIndex),
    [basket, win.startIndex, win.endIndex]
  );

  const overlapCaption = useMemo(
    () => describeCandidateOverlap(overlap, basket.length),
    [overlap, basket.length]
  );

  // The table's sorted column IS the shared window, resolved to the nearest
  // horizon; tapping a column that is already leading flips the direction,
  // tapping another moves the shared window there. One time axis everywhere.
  const sortColumn = useMemo(() => horizonIndexForWindow(win), [win]);
  const cycleColumn = useCallback(
    (column: number) => {
      if (column === sortColumn) {
        setBestFirst((b) => !b);
      } else {
        setPreset(HORIZONS[column].key);
        setBestFirst(true);
      }
    },
    [sortColumn, setPreset]
  );

  // Live row counts for the caption - the same predicates the bodies use.
  const stockCount = useMemo(
    () => filterUniverse(TICKERS, query, sector).length,
    [query, sector]
  );
  const groups = useMemo(
    () => (view === 'groups' ? groupsForK(groupCount).groups : []),
    [view, groupCount]
  );
  const groupCountShown = useMemo(
    () => filterGroups(groups, query).length,
    [groups, query]
  );

  const caption = useMemo(() => {
    const through = `through ${formatDateShort(DATES[range.endIndex])}`;
    const skipNote = range.skip > 0 ? ` · ${range.skip}d skipped` : '';
    if (view === 'table') {
      // Each horizon drops its own tail, so the note lists them all.
      const skips = HORIZONS.map(
        (h) => withSkip(windowForPreset(h.key), skipEnabled, sessionsStale).skip
      );
      const names =
        stockCount === TICKERS.length
          ? `${TICKERS.length} names`
          : `${stockCount} of ${TICKERS.length} · ranks stay market-wide`;
      return `${names}${skipEnabled ? ` · skipping ${skips.join('/')}d` : ''}`;
    }
    if (view === 'groups') {
      if (!GROUPING_AVAILABLE) return 'correlation matrix not published yet';
      const ungrouped = UNGROUPED_COUNT ? ` · ${UNGROUPED_COUNT} ungrouped` : '';
      return `${groupCountShown} of ${groupCount} groups${ungrouped} · ${through}${skipNote}`;
    }
    return `${stockCount} ${stockCount === 1 ? 'name' : 'names'} · ${through}${skipNote}`;
  }, [view, stockCount, groupCountShown, groupCount, range, skipEnabled, sessionsStale]);

  // Groups are not a sector cut, so that view swaps the sector dropdown for
  // the control that actually governs it: how many groups to make.
  const sectorOptions = view === 'groups' ? [] : SECTORS;

  const viewSwitch = (
    <SegmentedControl<MarketView> segments={VIEW_SEGMENTS} value={view} onChange={setView} compact />
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.bg, paddingTop: insets.top }]}>
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
        sector={view === 'groups' ? `${groupCount} groups` : sector}
        sectors={view === 'groups' ? ['groups'] : sectorOptions}
        onOpenSectorPicker={() => setSheetOpen(true)}
      />

      {view === 'card' && (
        <StockListBody
          universe={TICKERS}
          query={query}
          sector={sector}
          overlap={overlap}
          overlapCaption={overlapCaption}
          showGestureHint
        />
      )}
      {view === 'table' && (
        <RankTableBody
          query={query}
          sector={sector}
          sortColumn={sortColumn}
          bestFirst={bestFirst}
          onCycleSort={cycleColumn}
        />
      )}
      {view === 'groups' && <GroupBody query={query} />}

      <WindowPicker
        visible={pickerOpen}
        window={win}
        onClose={() => setPickerOpen(false)}
        onApply={setCustomWindow}
      />

      {view === 'groups' ? (
        <OptionSheet
          visible={sheetOpen}
          title="Groups"
          footnote={`Every group holds within ±20% of ${Math.round(
            (GROUPING_AVAILABLE ? groupsForK(groupCount).target : 0)
          )} names. Fewer groups means broader themes; more means tighter ones.`}
          options={K_CHOICES.map((k) => ({
            key: String(k),
            label: `${k} groups`,
            caption: `about ${Math.round((503 - UNGROUPED_COUNT) / k)} names each`,
          }))}
          selected={String(groupCount)}
          onClose={() => setSheetOpen(false)}
          onSelect={(k) => setGroupCount(Number(k))}
        />
      ) : (
        <OptionSheet
          visible={sheetOpen}
          title="Sector"
          options={[
            { key: '', label: 'All sectors' },
            ...SECTORS.map((s) => ({ key: s, label: s })),
          ]}
          selected={sector ?? ''}
          onClose={() => setSheetOpen(false)}
          onSelect={(s) => setSector(s === '' ? null : s)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
