import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Chip, ListHeader } from '../components/ListHeader';
import { SegmentedControl } from '../components/SegmentedControl';
import { StockListBody, StockSortKey, filterUniverse } from '../components/StockListBody';
import { WindowPicker } from '../components/WindowPicker';
import { FAMILY_TICKERS } from '../data/families';
import { BY_SYMBOL, DATES, SECTORS, TICKERS, Ticker, formatDateShort } from '../data/market';
import { computeOverlap, describeCandidateOverlap } from '../data/overlap';
import { HORIZONS, horizonIndexForWindow } from '../data/ranks';
import { windowForPreset, withSkip } from '../data/windows';
import { useAppState } from '../state/AppState';
import { useColors } from '../theme/ThemeProvider';
import { FamilyBody, FamilySortKey, filterFamilies } from './FamilyListScreen';
import { RankTableBody } from './RankTableScreen';

type MarketView = 'card' | 'table' | 'families';

const VIEW_SEGMENTS: { key: MarketView; label: string }[] = [
  { key: 'card', label: 'Card' },
  { key: 'table', label: 'Table' },
  { key: 'families', label: 'Families' },
];

/**
 * The Market tab: one screen, three bodies.
 *
 * Card, Table and Families used to be three separate screens that each built
 * their own header, and switching between them moved every control a little -
 * the view switch hopped rows, the window row appeared and vanished, even the
 * theme button changed size. Now the screen owns one ListHeader and only the
 * body below it changes, so the chrome is a fixed frame the views swap inside.
 *
 * The same move made the state shared instead of per-view: the search text,
 * the sector filter and the sort survive a view switch, the window control
 * drives the table's leading column (and tapping a column drives it back),
 * and the family view is searchable and sortable like everything else. All of
 * it is local rather than persisted - the screen stays mounted for the life
 * of the session, which is the only continuity a glance needs.
 */
export function MarketScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const {
    watchlist, window: win, setPreset, setCustomWindow,
    metric, setMetric, skipEnabled, setSkipEnabled, sessionsStale,
  } = useAppState();

  const [view, setView] = useState<MarketView>('card');
  const [query, setQuery] = useState('');
  const [sector, setSector] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Per-view sort state, kept here rather than in the bodies so it survives
  // switching views and can drive the header's chips.
  const [sortKey, setSortKey] = useState<StockSortKey>('metric');
  const [descending, setDescending] = useState(true);
  const [famSort, setFamSort] = useState<FamilySortKey>('metric');
  const [famDescending, setFamDescending] = useState(true);
  const [bestFirst, setBestFirst] = useState(true);
  const [famSelected, setFamSelected] = useState<string[]>(() =>
    FAMILY_TICKERS.slice(0, 2).map((f) => f.symbol)
  );

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

  const toggleFamily = useCallback((key: string) => {
    setFamSelected((prev) => {
      if (prev.includes(key)) return prev.length > 1 ? prev.filter((k) => k !== key) : prev;
      const next = [...prev, key];
      return next.length > 4 ? next.slice(1) : next;
    });
  }, []);

  // Live row counts for the caption - the same predicates the bodies use.
  const stockCount = useMemo(
    () => filterUniverse(TICKERS, query, sector).length,
    [query, sector]
  );
  const familyCount = useMemo(() => filterFamilies(query).length, [query]);

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
    if (view === 'families') {
      if (!FAMILY_TICKERS.length) return 'family series not published yet';
      return `${familyCount} ${familyCount === 1 ? 'family' : 'families'} · ${through}${skipNote}`;
    }
    return `${stockCount} ${stockCount === 1 ? 'name' : 'names'} · ${through}${skipNote}`;
  }, [view, stockCount, familyCount, range, skipEnabled, sessionsStale]);

  // Chip rail per view. Sorts lead, sectors follow; families have no sectors
  // to filter, and the table sorts by its own columns.
  const chipGroups = useMemo((): Chip[][] => {
    const sectorChips: Chip[] = [null, ...SECTORS].map((s) => ({
      key: s ?? 'all',
      label: s ?? 'All sectors',
      active: sector === s,
      onPress: () => setSector(s),
    }));

    const metricLabel =
      metric === 'return' ? 'Return' : metric === 'residual' ? 'Residual' : 'Ratio';
    const arrow = (active: boolean, desc: boolean) => (active ? (desc ? ' ↓' : ' ↑') : '');

    if (view === 'card') {
      const cycle = (key: StockSortKey) => {
        if (sortKey === key) {
          setDescending((d) => !d);
        } else {
          setSortKey(key);
          // Overlap's useful direction is ascending, same as Symbol: lowest
          // correlation first, so the top of the list is whichever name would
          // add the most diversification.
          setDescending(key !== 'symbol' && key !== 'overlap');
        }
      };
      const sortChips: Chip[] = [
        // The chip names whatever the metric control is set to, so the sort
        // and its label can never describe different columns.
        { key: 'metric', label: `${metricLabel}${arrow(sortKey === 'metric', descending)}` },
        { key: 'cap', label: `Size${arrow(sortKey === 'cap', descending)}` },
        { key: 'symbol', label: `A–Z${arrow(sortKey === 'symbol', descending)}` },
        // Only offered once the basket itself qualifies for a score: with too
        // few names every score is null, and a sort with nothing to rank by
        // is a control that does nothing.
        ...(overlap.reason === 'ok'
          ? [{ key: 'overlap', label: `Overlap${arrow(sortKey === 'overlap', descending)}` }]
          : []),
      ].map((c) => ({
        ...c,
        active: sortKey === c.key,
        onPress: () => cycle(c.key as StockSortKey),
      }));
      return [sortChips, sectorChips];
    }

    if (view === 'families') {
      const cycle = (key: FamilySortKey) => {
        if (famSort === key) {
          setFamDescending((d) => !d);
        } else {
          setFamSort(key);
          setFamDescending(key !== 'name');
        }
      };
      const famChips: Chip[] = [
        { key: 'metric', label: `${metricLabel}${arrow(famSort === 'metric', famDescending)}` },
        { key: 'size', label: `Size${arrow(famSort === 'size', famDescending)}` },
        { key: 'name', label: `A–Z${arrow(famSort === 'name', famDescending)}` },
      ].map((c) => ({
        ...c,
        active: famSort === c.key,
        onPress: () => cycle(c.key as FamilySortKey),
      }));
      return [famChips];
    }

    return [sectorChips];
  }, [view, sector, metric, sortKey, descending, famSort, famDescending, overlap.reason]);

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
        chipGroups={chipGroups}
      />

      {view === 'card' && (
        <StockListBody
          universe={TICKERS}
          query={query}
          sector={sector}
          sortKey={sortKey}
          descending={descending}
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
      {view === 'families' && (
        <FamilyBody
          query={query}
          sortKey={famSort}
          descending={famDescending}
          selected={famSelected}
          onToggle={toggleFamily}
        />
      )}

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
