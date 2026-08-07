// Step 5 - pull the full earnings history for every name in the packed dataset.
//
// Uses the per-symbol endpoint rather than the bulk calendar. The bulk one is
// capped at 4000 records per call *regardless of the date range asked for*, and
// it spans every listed company on earth, so a five-year pull would be dozens
// of calls that are mostly symbols this app will never show. One call per
// symbol costs 500 calls and returns that name's entire history - AAPL comes
// back with 164 reported quarters going to 1985 - which is what a surprise has
// to be standardised against.
//
// Writes one file per symbol so an interrupted run resumes for free, exactly
// like the price stage.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fmp, mapPool, progress } from '../lib/fmp.mjs';

const CONCURRENCY = 8;

async function main() {
  const dataset = JSON.parse(readFileSync('assets/data/market.json', 'utf8'));
  const symbols = dataset.tickers.map((t) => t.s);
  mkdirSync('data/earnings', { recursive: true });

  const force = process.argv.includes('--force');
  let done = 0;
  const failed = [];

  console.log(`  fetching earnings for ${symbols.length} symbols`);

  await mapPool(symbols, CONCURRENCY, async (symbol) => {
    const path = `data/earnings/${symbol}.json`;
    if (!force && existsSync(path)) {
      progress('earnings', ++done, symbols.length);
      return;
    }
    try {
      const rows = await fmp('earnings', { symbol });
      // Scheduled future dates come back with null actuals. They are kept:
      // the one thing this data reliably supports is telling you a report is
      // coming, and that is exactly the row carrying it.
      const clean = (Array.isArray(rows) ? rows : [])
        .filter((r) => r.date)
        .map((r) => ({
          date: r.date,
          epsActual: r.epsActual ?? null,
          epsEstimated: r.epsEstimated ?? null,
          revenueActual: r.revenueActual ?? null,
          revenueEstimated: r.revenueEstimated ?? null,
        }))
        .sort((a, b) => (a.date < b.date ? -1 : 1));
      writeFileSync(path, JSON.stringify(clean));
    } catch (err) {
      failed.push({ symbol, error: String(err.message || err) });
    }
    progress('earnings', ++done, symbols.length);
  });

  if (failed.length) {
    writeFileSync('data/earnings-failures.json', JSON.stringify(failed, null, 2));
    console.log(`\n  ${failed.length} symbol(s) failed; see data/earnings-failures.json`);
  }
  console.log(`\n  done: ${symbols.length - failed.length}/${symbols.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
