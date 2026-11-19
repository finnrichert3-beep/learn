/**
 * A deliberately simple spaced-review schedule, one per node.
 *
 *   Again  -> comes back in 10 minutes, and the next gap starts over at 1 day
 *   Good   -> 1 day the first time, then each gap is about `ease` times the last (1, 3, 8, 20 days...)
 *   Easy   -> 4 days the first time, then grows faster and nudges `ease` up
 *
 * Reviewing a node before it is due never pushes its date further out (Good and Easy
 * leave the schedule alone); Again still resets it, because forgetting is forgetting.
 *
 * A node that has never been reviewed is "new", not "due": it only starts
 * asking for attention once you have reviewed it at least once.
 */

export type Grade = 'again' | 'good' | 'easy';

export interface ReviewState {
  /** Current gap between reviews, in days. 0 while the node is being relearned. */
  interval: number;
  /** Growth factor for the gap. Starts at 2.5, stays between 1.3 and 3. */
  ease: number;
  /** When the node is due next (ms since 1970). */
  due: number;
  /** When it was last reviewed (ms since 1970). */
  last: number;
  /** How many times it has been reviewed. */
  reviews: number;
}

export type ReviewStatus = 'new' | 'due' | 'scheduled';

export const MINUTE_MS = 60_000;
export const DAY_MS = 86_400_000;
export const AGAIN_DELAY_MS = 10 * MINUTE_MS;
export const START_EASE = 2.5;
export const MIN_EASE = 1.3;
export const MAX_EASE = 3;
export const MAX_INTERVAL_DAYS = 365;

const GRADE_ORDER: Record<Grade, number> = { again: 0, good: 1, easy: 2 };

/** The schedule after reviewing a node at time `now` with the given grade. */
export function schedule(previous: ReviewState | undefined, grade: Grade, now: number): ReviewState {
  const ease = previous?.ease ?? START_EASE;
  const interval = previous?.interval ?? 0;
  const reviews = (previous?.reviews ?? 0) + 1;

  if (grade === 'again') {
    return { interval: 0, ease: Math.max(MIN_EASE, round2(ease - 0.2)), due: now + AGAIN_DELAY_MS, last: now, reviews };
  }

  // Early review of something already on a schedule: count it, but keep the date.
  // Otherwise going through the same card five times in one sitting would buy 50 days.
  if (previous && previous.interval >= 1 && now < previous.due) {
    return { ...previous, last: now, reviews };
  }

  const good = interval < 1 ? 1 : Math.max(interval + 1, Math.round(interval * ease));
  let next = good;
  let nextEase = ease;
  if (grade === 'easy') {
    // Easy is always at least a day further out than Good would have been.
    next = interval < 1 ? 4 : Math.max(good + 1, Math.round(interval * ease * 1.3));
    nextEase = Math.min(MAX_EASE, round2(ease + 0.15));
  }
  next = Math.min(MAX_INTERVAL_DAYS, next);
  return { interval: next, ease: nextEase, due: now + next * DAY_MS, last: now, reviews };
}

export function statusOf(state: ReviewState | undefined, now: number): ReviewStatus {
  if (!state) return 'new';
  return state.due <= now ? 'due' : 'scheduled';
}

export function isDue(state: ReviewState | undefined, now: number): boolean {
  return statusOf(state, now) === 'due';
}

/** The lower of two grades (Again < Good < Easy). A node is graded by its weakest card. */
export function worseGrade(a: Grade, b: Grade): Grade {
  return GRADE_ORDER[a] <= GRADE_ORDER[b] ? a : b;
}

/** "10 min", "3 hours", "1 day", "3 weeks", "4 months": a short label for a time span. */
export function formatSpan(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / MINUTE_MS));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return plural(hours, 'hour');
  const days = Math.round(hours / 24);
  if (days < 14) return plural(days, 'day');
  if (days < 60) return plural(Math.round(days / 7), 'week');
  if (days < 365) return plural(Math.round(days / 30), 'month');
  return plural(Math.round(days / 365), 'year');
}

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? '' : 's'}`;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
