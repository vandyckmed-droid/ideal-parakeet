// Step 4 - refuse to ship a dataset that isn't shaped like the last one.
//
// Stages 1-3 can succeed and still produce something wrong: an upstream schema
// change, a truncated response that survives retries, a screener that returns
// half a universe. Run by hand that gets noticed. Run on a schedule, with the
// result committed and fetched by every phone running the Snack build, it
// would not - so this asserts the invariants the app relies on and exits
// non-zero rather than letting a bad snapshot through.
//
// Deliberately checks structure and known landmarks, not prices. "Is NVDA's
// close plausible" needs a second source to answer and would fail on real
// moves; "does every series end on the same day and is the universe still 500
// names" is answerable from the file itself and catches the failures that
// actually happen.

import { readFileSync } from 'node:fs';

const PATH = 'assets/data/market.json';

// The S&P 500 holds ~503 lines because a few companies list two share
// classes. A count outside this band means the constituent endpoint broke.
const MIN_TICKERS = 495;
const MAX_TICKERS = 515;

// Landmarks. GOOG alongside GOOGL proves dual share classes survive the
// build; the excludes are baby bonds and preferreds that impersonate their
// parent in screeners, plus foreign ADRs (ASML, TSM) that are large but are
// not index members and so must be absent now.
const MUST_INCLUDE = ['AAPL', 'MSFT', 'NVDA', 'BRK-B', 'GOOG', 'GOOGL', 'MU', 'SO', 'APO'];
const MUST_EXCLUDE = ['SOJE', 'SOMN', 'CCZ', 'APOS', 'PPLC', 'STRC', 'STRD', 'STRK', 'RZC', 'ASML', 'TSM'];

const problems = [];
const fail = (msg) => problems.push(msg);

const raw = readFileSync(PATH, 'utf8');
const data = JSON.parse(raw);

// --- shape -------------------------------------------------------------------

if (!Array.isArray(data.dates) || data.dates.length === 0) fail('dates is missing or empty');
if (!Array.isArray(data.tickers)) fail('tickers is missing');
if (typeof data.generatedAt !== 'string') fail('generatedAt is missing');

const dates = data.dates ?? [];
const tickers = data.tickers ?? [];
const lastIndex = dates.length - 1;

if (tickers.length < MIN_TICKERS || tickers.length > MAX_TICKERS) {
  fail(`expected ${MIN_TICKERS}-${MAX_TICKERS} tickers, got ${tickers.length}`);
}

// --- calendar ----------------------------------------------------------------

for (let i = 1; i < dates.length; i++) {
  if (!(dates[i] > dates[i - 1])) {
    fail(`dates are not strictly increasing at ${i}: ${dates[i - 1]} -> ${dates[i]}`);
    break;
  }
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(dates[lastIndex] ?? '')) {
  fail(`last date is not YYYY-MM-DD: ${dates[lastIndex]}`);
}

// A snapshot dated in the future means a clock or timezone bug upstream.
const today = new Date().toISOString().slice(0, 10);
if (dates[lastIndex] > today) {
  fail(`last date ${dates[lastIndex]} is in the future (today ${today})`);
}

// The whole app treats a window as a pair of indices into this one calendar.
// Two years of sessions is ~504; well under that means a truncated pull.
if (dates.length < 400) fail(`only ${dates.length} sessions, expected ~500`);

// --- per-ticker invariants ---------------------------------------------------

const symbols = new Set();
let checked = 0;

for (const t of tickers) {
  const s = t.s;
  if (!s) { fail('a ticker has no symbol'); continue; }
  if (symbols.has(s)) fail(`duplicate symbol ${s}`);
  symbols.add(s);

  if (!Array.isArray(t.p) || t.p.length === 0) { fail(`${s}: no closes`); continue; }
  if (!Number.isInteger(t.o) || t.o < 0) { fail(`${s}: bad offset ${t.o}`); continue; }

  // Every series must end on the newest session - stage 3 drops any partial
  // day precisely so this holds, and the whole index-arithmetic model breaks
  // if it doesn't.
  if (t.o + t.p.length - 1 !== lastIndex) {
    fail(`${s}: series ends at index ${t.o + t.p.length - 1}, calendar ends at ${lastIndex}`);
  }

  for (let i = 0; i < t.p.length; i++) {
    const v = t.p[i];
    if (!Number.isFinite(v) || v <= 0) {
      fail(`${s}: bad close ${v} at local index ${i}`);
      break;
    }
  }

  if (!(t.mc > 0)) fail(`${s}: non-positive market cap ${t.mc}`);
  if (!(t.adv > 0)) fail(`${s}: non-positive dollar volume ${t.adv}`);
  if (!t.se) fail(`${s}: no sector`);
  checked++;
}

// --- the market reference ----------------------------------------------------
// The residual metric divides by this series' variance, so a missing or short
// one would silently turn every residual figure into a null on the phone.

const market = data.market;
if (!market || typeof market !== 'object') {
  fail('market reference is missing');
} else {
  if (market.s !== 'SPY') fail(`market reference is ${market.s}, expected SPY`);
  if (!Array.isArray(market.p) || market.p.length === 0) fail('market reference has no closes');
  if (!Number.isInteger(market.o) || market.o < 0) fail(`market reference has bad offset ${market.o}`);
  if (Array.isArray(market.p) && Number.isInteger(market.o)) {
    if (market.o + market.p.length - 1 !== lastIndex) {
      fail(
        `market reference ends at index ${market.o + market.p.length - 1}, ` +
          `calendar ends at ${lastIndex}`
      );
    }
    // It has to span the whole calendar, or the longest windows would measure
    // some names against a market that had not started yet.
    if (market.o !== 0) fail(`market reference starts at index ${market.o}, expected 0`);
    for (let i = 0; i < market.p.length; i++) {
      const v = market.p[i];
      if (!Number.isFinite(v) || v <= 0) { fail(`market reference: bad close ${v} at ${i}`); break; }
    }
  }
  // SPY is the yardstick, not a constituent; it must never rank in the list.
  if (symbols.has('SPY')) fail('SPY appears in the universe, it is not an index member');
}

// --- universe landmarks ------------------------------------------------------

for (const s of MUST_INCLUDE) if (!symbols.has(s)) fail(`expected ${s} in the universe`);
for (const s of MUST_EXCLUDE) if (symbols.has(s)) fail(`${s} should have been filtered out`);

// --- report ------------------------------------------------------------------

const sizeKb = Math.round(raw.length / 1024);
console.log(`  ${PATH}: ${tickers.length} tickers, ${dates.length} sessions, ${sizeKb} KB`);
console.log(`  calendar ${dates[0]} -> ${dates[lastIndex]}, generated ${data.generatedAt}`);
console.log(`  ${checked} tickers passed per-series checks`);

if (problems.length) {
  console.error(`\n  FAILED with ${problems.length} problem(s):`);
  for (const p of problems.slice(0, 20)) console.error(`    - ${p}`);
  if (problems.length > 20) console.error(`    ... and ${problems.length - 20} more`);
  process.exit(1);
}

console.log('\n  dataset looks sane');
