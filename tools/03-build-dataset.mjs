// Step 3 - turn ~800 noisy candidates into a clean set of exactly 500, and
// pack them into the single JSON asset the app ships with.
//
// The interesting work is separating common shares from the instruments that
// impersonate them. FMP stamps the *parent company's* market cap onto baby
// bonds and preferred series, so SOJE (Southern Company junior subordinated
// notes) and SOMN look like $90B companies on a screener. What gives them
// away is that nobody trades them: they turn over a few hundred thousand
// dollars a day against the common's hundreds of millions. Traded liquidity,
// not size, is the discriminator.
//
// Output: data/universe.json (audit trail) and assets/data/market.json (app)

import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';

const TARGET = 500;
const MIN_BARS = 252; // ~1 trading year of history
const MIN_ADV = 10e6; // $10M/day median turnover over the last quarter
const ADV_WINDOW = 60;

// Corporate-form suffixes and share-class markers. Stripping these is what
// collapses "Alphabet Inc." / "Alphabet Inc. Class C" onto one key, and just
// as importantly collapses "Southern Company" onto its baby bonds so the
// dedupe pass can drop them.
const NOISE =
  /\b(inc|incorporated|corp|corporation|company|co|plc|ltd|limited|llc|lp|sa|nv|ag|se|holdings?|group|the|class|[ab]|adr|ads|new|common|stock|shares?|series\s*\w*|depositary|preferred)\b/g;

function normalizeName(name) {
  return (name || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[.,'’\-/]/g, ' ')
    .replace(/\(.*?\)/g, ' ')
    .replace(NOISE, ' ')
    .replace(/[^a-z0-9]+/g, '');
}

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
      /* symbol had no history file; it simply drops out */
    }
  }
  const partial = findPartialSessions([...loaded.values()]);

  // --- load history and derive liquidity -----------------------------------
  const enriched = [];
  for (const c of candidates) {
    let bars = loaded.get(c.symbol);
    if (!bars) continue;
    if (partial.size) bars = bars.filter((b) => !partial.has(b.d));
    if (bars.length < MIN_BARS) continue;

    const tail = bars.slice(-ADV_WINDOW);
    // Median rather than mean: one index-rebalance print can inflate a mean
    // enough to float an otherwise untraded instrument over the threshold.
    const adv = median(tail.map((b) => b.c * (b.v || 0)));
    enriched.push({ ...c, bars, adv, lastClose: bars[bars.length - 1].c });
  }

  // --- liquidity gate ------------------------------------------------------
  const liquid = enriched.filter((e) => e.adv >= MIN_ADV);

  // --- one line per company ------------------------------------------------
  // Among share classes of the same issuer, keep whichever the market
  // actually trades. That picks GOOGL over GOOG, BRK-B over BRK-A, and the
  // common over every bond and preferred wearing the same name.
  const byCompany = new Map();
  for (const e of liquid) {
    const key = normalizeName(e.name) || e.symbol.toLowerCase();
    const held = byCompany.get(key);
    if (!held || e.adv > held.adv) byCompany.set(key, e);
  }

  const deduped = [...byCompany.values()].sort(
    (a, b) => (b.marketCap || 0) - (a.marketCap || 0)
  );
  const universe = deduped.slice(0, TARGET);

  console.log(`  candidates            ${candidates.length}`);
  console.log(`  with >=${MIN_BARS} bars       ${enriched.length}`);
  console.log(`  ADV >= $${MIN_ADV / 1e6}M          ${liquid.length}`);
  console.log(`  after name dedupe     ${deduped.length}`);
  console.log(`  final universe        ${universe.length}`);

  if (universe.length < TARGET) {
    console.warn(`  WARNING: only ${universe.length} names survived filtering`);
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

  mkdirSync('assets/data', { recursive: true });
  const payload = {
    generatedAt: new Date().toISOString().slice(0, 10),
    dates,
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
