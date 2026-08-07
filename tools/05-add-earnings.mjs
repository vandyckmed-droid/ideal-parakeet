// Step 5 - fold two earnings facts into the packed dataset.
//
// Only two, and neither is a forecast. The research under tools/research/
// tested the standard surprise score (SUE) against forward returns across two
// denominators, five lookback windows and three horizons - thirty cells, every
// one reported in the README - and found no drift to trade. What the same data
// supports strongly is that a report is a volatility event, so that is what
// ships:
//
//   er  the next scheduled report date, or absent if none is scheduled
//   em  this name's own median absolute 2-day move across its past reports
//
// `em` is per-name rather than the universe average because the average is
// nearly useless here: it runs from about 2% for a utility to well over 10%
// for a high-multiple software name, and the whole point is knowing which one
// you are holding.
//
// Raw move, not market-relative. A holder experiences the whole move, and a
// market-adjusted figure would understate what actually shows up in the price.

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';

const DATASET = 'assets/data/market.json';
const MIN_REPORTS = 4; // below this a median is not describing a habit

function main() {
  if (!existsSync('data/earnings')) {
    console.error('  data/earnings/ missing - run tools/04-fetch-earnings.mjs first');
    process.exit(1);
  }

  const ds = JSON.parse(readFileSync(DATASET, 'utf8'));
  const dates = ds.dates;
  const lastIndex = dates.length - 1;
  const today = new Date().toISOString().slice(0, 10);

  // First trading-day index on or after a calendar date, or -1 if beyond the
  // calendar entirely.
  const idxOf = new Map(dates.map((d, i) => [d, i]));
  const tradingIndex = (date) => {
    if (idxOf.has(date)) return idxOf.get(date);
    let lo = 0;
    let hi = lastIndex;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (dates[mid] < date) lo = mid + 1;
      else hi = mid;
    }
    return dates[lo] >= date ? lo : -1;
  };

  let withDate = 0;
  let withMove = 0;

  for (const t of ds.tickers) {
    const path = `data/earnings/${t.s}.json`;
    if (!existsSync(path)) continue;
    const reports = JSON.parse(readFileSync(path, 'utf8'));

    // --- next scheduled report ------------------------------------------------
    // A row with no actual EPS and a date ahead of today is a scheduled one.
    const upcoming = reports
      .filter((r) => r.epsActual === null && r.date > today)
      .map((r) => r.date)
      .sort();
    if (upcoming.length) {
      t.er = upcoming[0];
      withDate++;
    }

    // --- how much this name moves on the day ---------------------------------
    const moves = [];
    for (const r of reports) {
      if (r.epsActual === null) continue;
      const i = tradingIndex(r.date);
      if (i < 1 || i + 1 > lastIndex) continue;
      const before = i - 1 - t.o;
      const after = i + 1 - t.o;
      if (before < 0 || after >= t.p.length) continue;
      moves.push(Math.abs(t.p[after] / t.p[before] - 1));
    }
    if (moves.length >= MIN_REPORTS) {
      moves.sort((a, b) => a - b);
      const mid = Math.floor(moves.length / 2);
      const median =
        moves.length % 2 ? moves[mid] : (moves[mid - 1] + moves[mid]) / 2;
      // Three decimals: 0.047 is 4.7%, and more precision than that is noise
      // on a sample this size.
      t.em = Math.round(median * 1000) / 1000;
      withMove++;
    }
  }

  writeFileSync(DATASET, JSON.stringify(ds));

  const size = Math.round(readFileSync(DATASET).length / 1024);
  console.log(`  next report date: ${withDate}/${ds.tickers.length} names`);
  console.log(`  typical move:     ${withMove}/${ds.tickers.length} names`);
  console.log(`  ${DATASET} now ${size} KB`);
}

main();
