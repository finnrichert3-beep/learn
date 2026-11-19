import type { ReviewState } from './scheduler';

/** Review progress for every node, keyed by node id. Lives in this browser only. */
export type ReviewStore = Record<string, ReviewState>;

export const STORAGE_KEY = 'galaxy.review.v1';

/** The slice of the Web Storage API that is used here (so tests can pass a fake). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Read saved progress from its JSON text. Anything unreadable or malformed is dropped,
 * entry by entry, so one bad value never costs the whole history.
 */
export function parseStore(raw: string | null | undefined): ReviewStore {
  const store = emptyStore();
  if (!raw) return store;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return store;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return store;
  for (const [id, value] of Object.entries(parsed)) {
    const state = toState(value);
    if (state) store[id] = state;
  }
  return store;
}

/**
 * A store with no prototype, so node ids such as "constructor" or "__proto__" are
 * ordinary keys and never collide with built-in object properties.
 */
export function emptyStore(): ReviewStore {
  return Object.create(null) as ReviewStore;
}

/**
 * Combine two copies of the store (for example this tab's and another tab's). For each
 * node the entry that was reviewed most recently wins.
 */
export function mergeStores(a: ReviewStore, b: ReviewStore): ReviewStore {
  const merged = emptyStore();
  for (const source of [a, b]) {
    for (const [id, state] of Object.entries(source)) {
      const existing = merged[id];
      if (!existing || state.last > existing.last) merged[id] = state;
    }
  }
  return merged;
}

function toState(value: unknown): ReviewState | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { interval, ease, due, last, reviews } = value as Record<string, unknown>;
  if (!isNumber(interval) || !isNumber(ease) || !isNumber(due) || !isNumber(last) || !isNumber(reviews)) return undefined;
  if (interval < 0 || ease <= 0 || reviews < 0) return undefined;
  return { interval, ease, due, last, reviews };
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** The browser's localStorage, or null where it is blocked (private mode, disabled cookies...). */
export function browserStorage(): StorageLike | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** Load saved progress. Never throws: without usable storage it returns an empty store. */
export function loadStore(storage: StorageLike | null = browserStorage()): ReviewStore {
  if (!storage) return emptyStore();
  try {
    return parseStore(storage.getItem(STORAGE_KEY));
  } catch {
    return emptyStore();
  }
}

/** Save progress. Returns false when the browser refuses (storage blocked or full). */
export function saveStore(store: ReviewStore, storage: StorageLike | null = browserStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(store));
    return true;
  } catch {
    return false;
  }
}
