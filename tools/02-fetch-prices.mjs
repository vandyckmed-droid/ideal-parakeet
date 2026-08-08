// Step 2 - pull ~2 years of split- and dividend-adjusted daily closes for
// every candidate. Adjusted closes matter: without them every split shows up
// as a fake -50% return and every dividend biases the series downward.
//
// Writes one file per symbol under data/prices/ so an interrupted run can be
// resumed without re-billing the whole universe.
//
// SPY is fetched alongside the constituents even though it is not one. It is
// the market the app measures each name against for the residual metric, and
// packing it beside the universe keeps that measurement on the same calendar
// and the same adjusted-close basis as everything else.

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { fmp, mapPool, progress } from './lib/fmp.mjs';

const YEARS = 2;
const MARKET_SYMBOL = 'SPY';
const CONCURRENCY = 8;

function dateNDaysAgo(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const constituents = JSON.parse(readFileSync('data/candidates.json', 'utf8'));
  // The market reference rides along; stage 3 packs it separately, so it never
  // enters the universe.
  const candidates = [...constituents, { symbol: MARKET_SYMBOL }];
  mkdirSync('data/prices', { recursive: true });

  // A little over two calendar years, so the first requested window still has
  // history on either side once weekends and holidays are dropped.
  const from = dateNDaysAgo(Math.round(YEARS * 365.25) + 10);
  const to = new Date().toISOString().slice(0, 10);
  console.log(`  fetching ${candidates.length} symbols, ${from} -> ${to}`);

  const force = process.argv.includes('--force');
  let done = 0;
  let failed = [];

  await mapPool(candidates, CONCURRENCY, async (c) => {
    const path = `data/prices/${c.symbol}.json`;
    if (!force && existsSync(path)) {
      progress('prices', ++done, candidates.length);
      return;
    }
    try {
      const rows = await fmp('historical-price-eod/dividend-adjusted', {
        symbol: c.symbol,
        from,
        to,
      });
      // FMP returns newest-first; store oldest-first so every downstream
      // window calculation can index forward through time.
      const bars = (Array.isArray(rows) ? rows : [])
        .map((r) => ({ d: r.date, c: r.adjClose, v: r.volume }))
        .filter((r) => r.d && Number.isFinite(r.c) && r.c > 0)
        .reverse();
      writeFileSync(path, JSON.stringify(bars));
    } catch (err) {
      failed.push({ symbol: c.symbol, error: String(err.message || err) });
    }
    progress('prices', ++done, candidates.length);
  });

  if (failed.length) {
    console.log(`\n  ${failed.length} symbols failed:`);
    for (const f of failed.slice(0, 20)) console.log(`    ${f.symbol}: ${f.error}`);
    writeFileSync('data/fetch-failures.json', JSON.stringify(failed, null, 2));
  } else {
    console.log('  all symbols fetched');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
