// Step 3 - pack the S&P 500 price histories into the single JSON asset the
// app ships with.
//
// Membership was settled in step 1 (the constituent list is the universe, so
// there is nothing to screen here) - this step's job is alignment: one master
// calendar, dense forward-filled series, and the wholesale drop of any
// still-in-progress session so a live intraday print never gets compared
// against yesterday's closes.
//
// Every constituent ships, including dual share classes (GOOGL and GOOG,
// FOXA and FOX) - the index holds both lines, so the app does too. A name
// that joined the index recently simply has a shorter series; the per-ticker
// offset already handles that.
//
// Output: data/universe.json (audit trail) and assets/data/market.json (app)

import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';

const ADV_WINDOW = 60;

// The market the app measures each name against for the residual metric. It is
// packed beside the universe, never inside it: SPY is not an index member and
// must not appear in a ranking of constituents.
const MARKET_SYMBOL = 'SPY';

function median(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * If the newest session is still in progress, only some symbols carry a bar
 * for it and those bars hold partial volume at an intraday price. Mixing that
 * into a cross-sectional comparison silently compares live prices against
 * yesterday's closes, so any such trailing session is dropped wholesale.
 *
 * Detected by turnover rather than by clock: a live session shows volume far
 * below each symbol's own typical day. Returns the set of dates to exclude.
 */
function findPartialSessions(seriesList) {
  const dropped = new Set();

  for (;;) {
    let latest = '';
    for (const bars of seriesList) {
      const d = bars[bars.length - 1]?.d;
      if (d && !dropped.has(d) && d > latest) latest = d;
    }
    if (!latest) return dropped;

    const ratios = [];
    for (const bars of seriesList) {
      const usable = bars.filter((b) => !dropped.has(b.d));
      const last = usable[usable.length - 1];
      if (!last || last.d !== latest) continue;
      const typical = median(usable.slice(-ADV_WINDOW - 1, -1).map((b) => b.v || 0));
      if (typical > 0) ratios.push((last.v || 0) / typical);
    }

    // Require a real sample before disqualifying a session.
    if (ratios.length < 20 || median(ratios) >= 0.6) return dropped;
    console.log(
      `  dropping in-progress session ${latest} ` +
        `(median turnover ${(median(ratios) * 100).toFixed(0)}% of normal)`
    );
    dropped.add(latest);
  }
}

function main() {
  const candidates = JSON.parse(readFileSync('data/candidates.json', 'utf8'));

  const loaded = new Map();
  for (const c of candidates) {
    try {
      const bars = JSON.parse(readFileSync(`data/prices/${c.symbol}.json`, 'utf8'));
      if (bars.length) loaded.set(c.symbol, bars);
    } catch {
      /* no history file - reported below */
    }
  }
  const partial = findPartialSessions([...loaded.values()]);

  const universe = [];
  const unpriced = [];
  for (const c of candidates) {
    let bars = loaded.get(c.symbol);
    if (bars && partial.size) bars = bars.filter((b) => !partial.has(b.d));
    // Two bars is the floor for drawing anything at all; below that the
    // symbol has effectively no history yet.
    if (!bars || bars.length < 2) {
      unpriced.push(c.symbol);
      continue;
    }
    // Median dollar turnover over the last quarter - display only (the
    // detail card and the Size sort), it gates nothing.
    const tail = bars.slice(-ADV_WINDOW);
    const adv = median(tail.map((b) => b.c * (b.v || 0)));
    universe.push({ ...c, bars, adv });
  }
  universe.sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0));

  console.log(`  constituents          ${candidates.length}`);
  console.log(`  with price history    ${universe.length}`);
  if (unpriced.length) console.log(`  no usable history:    ${unpriced.join(' ')}`);

  // An index member without prices means the fetch failed, not that the
  // company vanished. Better to fail than to quietly ship a partial index.
  if (unpriced.length > 5) {
    console.error(`  ${unpriced.length} constituents have no prices - aborting`);
    process.exit(1);
  }

  // --- pack for the app ----------------------------------------------------
  // Every series is aligned to one master calendar so the app can express a
  // date window as a pair of integer indices and do pure index arithmetic.
  const allDates = new Set();
  for (const u of universe) for (const b of u.bars) allDates.add(b.d);
  const dates = [...allDates].sort();
  const dateIndex = new Map(dates.map((d, i) => [d, i]));

  const tickers = universe.map((u) => {
    const offset = dateIndex.get(u.bars[0].d);
    // Dense from `offset` to the end of the calendar, forward-filling the
    // occasional missing print so index math never has to skip holes.
    const closes = new Array(dates.length - offset);
    let cursor = 0;
    let last = u.bars[0].c;
    for (let i = 0; i < closes.length; i++) {
      const d = dates[offset + i];
      while (cursor < u.bars.length && u.bars[cursor].d < d) cursor++;
      if (cursor < u.bars.length && u.bars[cursor].d === d) last = u.bars[cursor].c;
      closes[i] = Math.round(last * 1000) / 1000;
    }
    return {
      s: u.symbol,
      n: u.name,
      se: u.sector,
      in: u.industry,
      cy: u.country,
      x: u.exchange,
      mc: u.marketCap,
      adv: Math.round(u.adv),
      o: offset,
      p: closes,
    };
  });

  // --- the market reference -------------------------------------------------
  // Same master calendar, same forward-fill, so the app can line a name up
  // against it by index arithmetic exactly as it does with any other series.
  let market = null;
  try {
    let mBars = JSON.parse(readFileSync(`data/prices/${MARKET_SYMBOL}.json`, 'utf8'));
    if (partial.size) mBars = mBars.filter((b) => !partial.has(b.d));
    const first = mBars.findIndex((b) => dateIndex.has(b.d));
    if (first >= 0) {
      const offset = dateIndex.get(mBars[first].d);
      const closes = new Array(dates.length - offset);
      let cursor = first;
      let last = mBars[first].c;
      for (let i = 0; i < closes.length; i++) {
        const d = dates[offset + i];
        while (cursor < mBars.length && mBars[cursor].d < d) cursor++;
        if (cursor < mBars.length && mBars[cursor].d === d) last = mBars[cursor].c;
        closes[i] = Math.round(last * 1000) / 1000;
      }
      market = { s: MARKET_SYMBOL, o: offset, p: closes };
    }
  } catch {
    /* reported below */
  }
  if (!market) {
    console.error(`  no usable ${MARKET_SYMBOL} history - the residual metric needs it`);
    process.exit(1);
  }
  console.log(`  market reference ${MARKET_SYMBOL}: ${market.p.length} closes from index ${market.o}`);

  mkdirSync('assets/data', { recursive: true });
  const payload = {
    generatedAt: new Date().toISOString().slice(0, 10),
    dates,
    market,
    tickers,
  };
  writeFileSync('assets/data/market.json', JSON.stringify(payload));

  // Human-readable audit trail; the app never reads this one.
  writeFileSync(
    'data/universe.json',
    JSON.stringify(
      universe.map(({ bars, ...rest }) => ({ ...rest, bars: bars.length })),
      null,
      2
    )
  );

  const bytes = JSON.stringify(payload).length;
  console.log(
    `\n  ${dates.length} trading days, ${tickers.length} tickers`
  );
  console.log(`  wrote assets/data/market.json (${(bytes / 1e6).toFixed(1)} MB)`);
}

main();
