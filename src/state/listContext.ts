/**
 * The symbol order the user is currently looking at.
 *
 * The detail view swipes between neighbours, and "neighbour" has to mean the
 * next row in the list they came from - not the next row in some canonical
 * order. Passing 500 symbols through route params on every open would be
 * wasteful and lossy, so the list publishes its order here and the detail view
 * reads it on mount.
 */
let orderedSymbols: string[] = [];

export function setOrderedSymbols(symbols: string[]) {
  orderedSymbols = symbols;
}

export function getOrderedSymbols(): string[] {
  return orderedSymbols;
}

/** Same contract for the group detail's pager. */
let orderedGroups: string[] = [];

export function setOrderedGroups(keys: string[]) {
  orderedGroups = keys;
}

export function getOrderedGroups(): string[] {
  return orderedGroups;
}
