// Mirrors src/data/grouping.ts - if these two ever disagree, the .ts file is
// the one that is wrong.
//
// The shrunk correlation distances the grouping is built on, unpacked from the
// byte array the pipeline ships inside market.json. Only names with a complete
// return history over the correlation window are in here: a name that listed
// part-way through cannot be correlated against the rest over the same sample,
// so recent listings are simply ungrouped and the app says so.

let SYMBOLS = [];
let PACKED = new Uint8Array(0);
let INDEX_OF = new Map();
let META = { sessions: 0, from: '', to: '', shrinkage: 0, averageCorrelation: 0 };

// Base64 by hand rather than atob or Buffer: neither is reliably present in
// this runtime, and the payload is one flat byte array.
function decodeBase64(input) {
  const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lookup = new Uint8Array(128);
  for (let i = 0; i < CHARS.length; i++) lookup[CHARS.charCodeAt(i)] = i;
  let padding = 0;
  while (padding < 2 && input.charCodeAt(input.length - 1 - padding) === 61) padding++;
  const bytes = new Uint8Array((input.length / 4) * 3 - padding);
  let out = 0;
  for (let i = 0; i < input.length; i += 4) {
    const chunk =
      (lookup[input.charCodeAt(i)] << 18) |
      (lookup[input.charCodeAt(i + 1)] << 12) |
      (lookup[input.charCodeAt(i + 2)] << 6) |
      lookup[input.charCodeAt(i + 3)];
    if (out < bytes.length) bytes[out++] = (chunk >> 16) & 0xff;
    if (out < bytes.length) bytes[out++] = (chunk >> 8) & 0xff;
    if (out < bytes.length) bytes[out++] = chunk & 0xff;
  }
  return bytes;
}

/** App.js hands the payload over once on load, before anything clusters. */
export function setGrouping(g) {
  if (!g || !Array.isArray(g.symbols) || typeof g.distances !== 'string') {
    SYMBOLS = []; PACKED = new Uint8Array(0); INDEX_OF = new Map();
    return;
  }
  SYMBOLS = g.symbols;
  PACKED = decodeBase64(g.distances);
  INDEX_OF = new Map(SYMBOLS.map((s, i) => [s, i]));
  META = {
    sessions: g.sessions, from: g.from, to: g.to,
    shrinkage: g.shrinkage, averageCorrelation: g.averageCorrelation,
  };
}

export function groupSymbols() { return SYMBOLS; }
export function groupable() { return SYMBOLS.length; }
export function groupingMeta() { return META; }
export function hasGrouping() { return SYMBOLS.length > 0; }

function pairIndex(i, j, n) { return (i * (2 * n - i - 1)) / 2 + (j - i - 1); }

/** Shrunk correlation distance between two matrix rows. Zero on the diagonal. */
export function distance(i, j) {
  if (i === j) return 0;
  const n = SYMBOLS.length;
  return PACKED[i < j ? pairIndex(i, j, n) : pairIndex(j, i, n)] / 255;
}

/** d = sqrt((1-rho)/2), so rho = 1 - 2d^2. */
export function correlationFromDistance(d) { return 1 - 2 * d * d; }
