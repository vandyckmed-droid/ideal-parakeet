import React, { useMemo } from 'react';

import { BY_SYMBOL, TICKERS, Ticker } from '../../src/data/market';
import { OVERLAP_THRESHOLD, computeOverlap, countCandidateFlags } from '../../src/data/overlap';
import { TickerListScreen } from '../../src/screens/TickerListScreen';
import { useAppState } from '../../src/state/AppState';

export default function MarketScreen() {
  const { watchlist, window: win } = useAppState();

  const basket = useMemo(
    () =>
      watchlist
        .map((s) => BY_SYMBOL.get(s))
        .filter((t): t is Ticker => Boolean(t)),
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

  // Deliberately silent when the watchlist itself doesn't qualify (fewer than
  // 3 names, or too short a history) - that guidance belongs on the Watchlist
  // screen, not repeated here every time someone browses the Market tab.
  const overlapCaption = useMemo(() => {
    if (overlap.reason !== 'ok') return null;
    const count = countCandidateFlags(overlap);
    if (count === 0) return null;
    return `${count} name${count === 1 ? '' : 's'} would overlap your watchlist by ${Math.round(
      OVERLAP_THRESHOLD * 100
    )}% or more`;
  }, [overlap]);

  return (
    <TickerListScreen
      title="Market"
      universe={TICKERS}
      overlap={overlap}
      overlapCaption={overlapCaption}
    />
  );
}
