import { describe, expect, it } from 'vitest';
import {
  AGAIN_DELAY_MS,
  DAY_MS,
  MAX_EASE,
  MAX_INTERVAL_DAYS,
  MIN_EASE,
  formatSpan,
  isDue,
  schedule,
  statusOf,
  worseGrade,
  type Grade,
  type ReviewState,
} from '../src/review/scheduler';
import { STORAGE_KEY, emptyStore, loadStore, mergeStores, parseStore, saveStore, type StorageLike } from '../src/review/store';
import { ReviewSession } from '../src/review/session';

const NOW = Date.UTC(2026, 10, 19, 15, 0, 0);

function run(grades: Grade[], start: ReviewState | undefined = undefined): ReviewState {
  let state = start;
  let now = NOW;
  for (const grade of grades) {
    state = schedule(state, grade, now);
    now = state.due;
  }
  if (!state) throw new Error('no grades');
  return state;
}

describe('schedule', () => {
  it('first Good comes back tomorrow', () => {
    const state = schedule(undefined, 'good', NOW);
    expect(state).toEqual({ interval: 1, ease: 2.5, due: NOW + DAY_MS, last: NOW, reviews: 1 });
  });

  it('first Easy comes back in 4 days and raises the ease', () => {
    const state = schedule(undefined, 'easy', NOW);
    expect(state.interval).toBe(4);
    expect(state.due).toBe(NOW + 4 * DAY_MS);
    expect(state.ease).toBe(2.65);
  });

  it('Again comes back in 10 minutes and lowers the ease', () => {
    const state = schedule(undefined, 'again', NOW);
    expect(state.interval).toBe(0);
    expect(state.due).toBe(NOW + AGAIN_DELAY_MS);
    expect(state.ease).toBe(2.3);
  });

  it('Good on each due date spaces reviews further and further apart', () => {
    const intervals: number[] = [];
    let state: ReviewState | undefined;
    let now = NOW;
    for (let i = 0; i < 5; i++) {
      state = schedule(state, 'good', now);
      intervals.push(state.interval);
      now = state.due;
    }
    expect(intervals).toEqual([1, 3, 8, 20, 50]);
  });

  it('on the due date, Easy lands later than Good and Good later than Again', () => {
    for (const history of [[], ['good'], ['good', 'good'], ['easy', 'good', 'good'], ['again']] as Grade[][]) {
      const before = history.length > 0 ? run(history) : undefined;
      const now = before?.due ?? NOW;
      const again = schedule(before, 'again', now).due;
      const good = schedule(before, 'good', now).due;
      const easy = schedule(before, 'easy', now).due;
      expect(again).toBeLessThan(good);
      expect(good).toBeLessThan(easy);
    }
  });

  it('at the one-year cap Easy and Good land on the same day (never Easy sooner)', () => {
    const capped = run(Array<Grade>(12).fill('easy'));
    const good = schedule(capped, 'good', capped.due);
    const easy = schedule(capped, 'easy', capped.due);
    expect(good.interval).toBe(MAX_INTERVAL_DAYS);
    expect(easy.due).toBe(good.due);
  });

  it('reviewing before the due date does not push the date out', () => {
    const first = schedule(undefined, 'good', NOW);
    // Five more passes in the same sitting: the date must not move.
    let state = first;
    for (let i = 0; i < 5; i++) state = schedule(state, i % 2 === 0 ? 'good' : 'easy', NOW + 1000 * (i + 1));
    expect(state.due).toBe(first.due);
    expect(state.interval).toBe(1);
    expect(state.ease).toBe(first.ease);
    expect(state.reviews).toBe(6);
    expect(state.last).toBe(NOW + 5000);
  });

  it('forgetting early still resets, and relearning can graduate without waiting', () => {
    const scheduled = run(['good', 'good']);
    const lapsed = schedule(scheduled, 'again', NOW + 60_000);
    expect(lapsed.interval).toBe(0);
    expect(lapsed.due).toBe(NOW + 60_000 + AGAIN_DELAY_MS);
    // Still inside the 10 minutes, a Good moves it on to tomorrow.
    expect(schedule(lapsed, 'good', NOW + 120_000).interval).toBe(1);
  });

  it('Again resets the gap: the next Good is 1 day, not the old long gap', () => {
    const lapsed = schedule(run(['good', 'good', 'good']), 'again', NOW);
    expect(lapsed.interval).toBe(0);
    expect(schedule(lapsed, 'good', NOW).interval).toBe(1);
  });

  it('keeps ease and interval inside their limits', () => {
    expect(run(Array<Grade>(12).fill('again')).ease).toBe(MIN_EASE);
    expect(run(Array<Grade>(12).fill('easy')).ease).toBe(MAX_EASE);
    expect(run(Array<Grade>(12).fill('easy')).interval).toBe(MAX_INTERVAL_DAYS);
  });

  it('counts reviews and records when the last one happened', () => {
    const state = schedule(schedule(undefined, 'good', NOW), 'easy', NOW + 5);
    expect(state.reviews).toBe(2);
    expect(state.last).toBe(NOW + 5);
  });

  it('does not change the state it was given', () => {
    const before = schedule(undefined, 'good', NOW);
    const copy = { ...before };
    schedule(before, 'easy', NOW);
    expect(before).toEqual(copy);
  });
});

describe('due status', () => {
  const state = schedule(undefined, 'good', NOW);

  it('a node that was never reviewed is new, not due', () => {
    expect(statusOf(undefined, NOW)).toBe('new');
    expect(isDue(undefined, NOW)).toBe(false);
  });

  it('becomes due exactly when its time arrives', () => {
    expect(statusOf(state, NOW)).toBe('scheduled');
    expect(isDue(state, state.due - 1)).toBe(false);
    expect(isDue(state, state.due)).toBe(true);
    expect(statusOf(state, state.due + DAY_MS)).toBe('due');
  });
});

describe('worseGrade', () => {
  it('orders Again < Good < Easy', () => {
    expect(worseGrade('good', 'again')).toBe('again');
    expect(worseGrade('easy', 'good')).toBe('good');
    expect(worseGrade('easy', 'easy')).toBe('easy');
  });
});

describe('formatSpan', () => {
  it.each([
    [AGAIN_DELAY_MS, '10 min'],
    [10_000, '1 min'],
    [3 * 3_600_000, '3 hours'],
    [DAY_MS, '1 day'],
    [8 * DAY_MS, '8 days'],
    [20 * DAY_MS, '3 weeks'],
    [120 * DAY_MS, '4 months'],
    [365 * DAY_MS, '1 year'],
  ])('%d ms -> %s', (ms, label) => {
    expect(formatSpan(ms)).toBe(label);
  });
});

describe('review store', () => {
  const fakeStorage = (initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } => ({
    data: { ...initial },
    getItem(key) {
      return this.data[key] ?? null;
    },
    setItem(key, value) {
      this.data[key] = value;
    },
  });

  it('round-trips through storage', () => {
    const storage = fakeStorage();
    const store = { 'calc-limits': schedule(undefined, 'good', NOW) };
    expect(saveStore(store, storage)).toBe(true);
    expect(Object.keys(storage.data)).toEqual([STORAGE_KEY]);
    expect(loadStore(storage)).toEqual(store);
  });

  it('starts empty when nothing was saved', () => {
    expect(loadStore(fakeStorage())).toEqual({});
    expect(parseStore(null)).toEqual({});
  });

  it.each(['not json', '[]', '"text"', '42', 'null'])('ignores unreadable data: %s', (raw) => {
    expect(parseStore(raw)).toEqual({});
  });

  it('drops malformed entries but keeps the good ones', () => {
    const good = schedule(undefined, 'easy', NOW);
    const raw = JSON.stringify({ ok: good, missing: { interval: 1 }, wrongType: { ...good, due: 'tomorrow' }, negative: { ...good, interval: -1 }, text: 'x' });
    expect(parseStore(raw)).toEqual({ ok: good });
  });

  it('treats node ids like "constructor" and "__proto__" as ordinary keys', () => {
    const store = emptyStore();
    expect(store['constructor']).toBeUndefined();
    expect(store['toString']).toBeUndefined();
    expect(parseStore('{}')['constructor']).toBeUndefined();

    const state = schedule(undefined, 'good', NOW);
    store['constructor'] = state;
    store['__proto__'] = state;
    const storage = fakeStorage();
    saveStore(store, storage);
    const loaded = loadStore(storage);
    expect(Object.keys(loaded).sort()).toEqual(['__proto__', 'constructor']);
    expect(loaded['__proto__']).toEqual(state);
  });

  it('merges two copies, keeping the most recent review of each node', () => {
    const older = schedule(undefined, 'good', NOW);
    const newer = schedule(older, 'again', NOW + 5000);
    const other = schedule(undefined, 'easy', NOW);
    const mine = Object.assign(emptyStore(), { a: older, b: other });
    const theirs = Object.assign(emptyStore(), { a: newer, c: other });
    const merged = mergeStores(mine, theirs);
    expect(merged['a']).toEqual(newer);
    expect(Object.keys(merged).sort()).toEqual(['a', 'b', 'c']);
    expect(mergeStores(theirs, mine)['a']).toEqual(newer);
  });

  it('never throws when storage is blocked, missing or full', () => {
    const blocked: StorageLike = {
      getItem() {
        throw new Error('SecurityError');
      },
      setItem() {
        throw new Error('QuotaExceededError');
      },
    };
    expect(loadStore(blocked)).toEqual({});
    expect(saveStore({}, blocked)).toBe(false);
    expect(loadStore(null)).toEqual({});
    expect(saveStore({}, null)).toBe(false);
  });
});

describe('ReviewSession', () => {
  it('walks every card of every node in order', () => {
    const session = new ReviewSession([
      { node: 4, cards: 2 },
      { node: 9, cards: 1 },
    ]);
    const seen: string[] = [];
    while (!session.finished) {
      seen.push(`${session.current?.node}:${session.current?.card}`);
      session.answer('good');
    }
    expect(seen).toEqual(['4:0', '4:1', '9:0']);
    expect(session.results).toEqual([
      { node: 4, grade: 'good' },
      { node: 9, grade: 'good' },
    ]);
  });

  it('reports a node only once all of its cards are answered, graded by the weakest', () => {
    const session = new ReviewSession([{ node: 1, cards: 3 }]);
    expect(session.answer('easy')).toBeUndefined();
    expect(session.answer('good')).toBeUndefined();
    expect(session.answer('easy')).toEqual({ node: 1, grade: 'good' });
  });

  it('brings an "Again" card back at the end, without changing the node grade afterwards', () => {
    const session = new ReviewSession([
      { node: 1, cards: 1 },
      { node: 2, cards: 1 },
    ]);
    expect(session.progress).toEqual({ index: 1, total: 2 });
    expect(session.answer('again')).toEqual({ node: 1, grade: 'again' });
    expect(session.progress).toEqual({ index: 2, total: 3 });
    expect(session.answer('easy')).toEqual({ node: 2, grade: 'easy' });
    expect(session.finished).toBe(false);
    expect(session.current).toEqual({ node: 1, card: 0 });
    expect(session.answer('easy')).toBeUndefined();
    expect(session.finished).toBe(true);
    expect(session.results).toEqual([
      { node: 1, grade: 'again' },
      { node: 2, grade: 'easy' },
    ]);
  });

  it('knows when a card is a repeat, and the weakest grade given so far', () => {
    const session = new ReviewSession([{ node: 1, cards: 2 }]);
    expect(session.currentIsRepeat).toBe(false);
    expect(session.pendingGrade(1)).toBeUndefined();
    session.answer('again');
    expect(session.pendingGrade(1)).toBe('again');
    expect(session.currentIsRepeat).toBe(false);
    session.answer('easy');
    expect(session.pendingGrade(1)).toBe('again');
    expect(session.currentIsRepeat).toBe(true);
    expect(session.pendingGrade(7)).toBeUndefined();
  });

  it('lists the nodes that still have cards waiting', () => {
    const session = new ReviewSession([
      { node: 1, cards: 1 },
      { node: 2, cards: 2 },
      { node: 3, cards: 1 },
    ]);
    expect(session.remainingNodes()).toEqual([1, 2, 3]);
    session.answer('again');
    expect(session.remainingNodes()).toEqual([2, 3, 1]);
    session.answer('good');
    session.answer('good');
    expect(session.remainingNodes()).toEqual([3, 1]);
  });

  it('hides the answer again after each card', () => {
    const session = new ReviewSession([{ node: 1, cards: 2 }]);
    expect(session.revealed).toBe(false);
    session.reveal();
    expect(session.revealed).toBe(true);
    session.answer('good');
    expect(session.revealed).toBe(false);
  });

  it('skips nodes without cards and ignores answers once finished', () => {
    const session = new ReviewSession([
      { node: 1, cards: 0 },
      { node: 2, cards: 1 },
      { node: 2, cards: 1 },
    ]);
    expect(session.nodeCount).toBe(1);
    expect(session.progress.total).toBe(1);
    session.answer('good');
    expect(session.answer('good')).toBeUndefined();
    expect(session.current).toBeUndefined();
    expect(new ReviewSession([]).finished).toBe(true);
  });
});
