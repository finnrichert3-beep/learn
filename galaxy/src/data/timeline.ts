/**
 * Timeline maths. Everything works in whole "day numbers" (days since 1970-01-01, UTC)
 * so dates never shift with the viewer's time zone.
 */

const MS_PER_DAY = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-11-18" -> day number. Assumes the date was already validated. */
export function dayNumber(date: string): number {
  const [year = 1970, month = 1, day = 1] = date.split('-').map(Number);
  return Math.round(Date.UTC(year, month - 1, day) / MS_PER_DAY);
}

/** Day number -> "Nov 2026". */
export function monthLabel(day: number): string {
  const date = new Date(day * MS_PER_DAY);
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** Day number -> "Nov 18, 2026". */
export function dateLabel(day: number): string {
  const date = new Date(day * MS_PER_DAY);
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

export interface TimelineRange {
  /** Day of the earliest node. */
  start: number;
  /** Day of the latest node. */
  end: number;
}

export function timelineRange(days: readonly number[]): TimelineRange {
  if (days.length === 0) return { start: 0, end: 0 };
  let start = Infinity;
  let end = -Infinity;
  for (const day of days) {
    if (day < start) start = day;
    if (day > end) end = day;
  }
  return { start, end };
}

/** A node is on screen once the timeline has reached its date (inclusive). */
export function isVisibleAt(nodeDay: number, currentDay: number): boolean {
  return nodeDay <= currentDay;
}

/** One boolean per node, in order: is it visible when the timeline is at `currentDay`? */
export function visibleMask(days: readonly number[], currentDay: number): boolean[] {
  return days.map((day) => isVisibleAt(day, currentDay));
}

export function countVisible(days: readonly number[], currentDay: number): number {
  let count = 0;
  for (const day of days) if (isVisibleAt(day, currentDay)) count++;
  return count;
}

/** Whole day the timeline shows for a playback position, clamped to the range. */
export function dayAt(range: TimelineRange, position: number): number {
  return Math.min(range.end, Math.max(range.start, Math.floor(position)));
}

export interface MonthTick {
  /** First day of the month. */
  day: number;
  /** "Sep" */
  label: string;
  /** 0-1 position along the timeline. */
  fraction: number;
}

/** Month boundaries that fall inside the range, for tick marks under the scrubber. */
export function monthTicks(range: TimelineRange): MonthTick[] {
  const ticks: MonthTick[] = [];
  const span = range.end - range.start;
  if (span <= 0) return ticks;
  const first = new Date(range.start * MS_PER_DAY);
  let year = first.getUTCFullYear();
  let month = first.getUTCMonth();
  for (;;) {
    const day = Math.round(Date.UTC(year, month, 1) / MS_PER_DAY);
    if (day > range.end) break;
    if (day >= range.start) {
      ticks.push({ day, label: MONTHS[month] ?? '', fraction: (day - range.start) / span });
    }
    month++;
    if (month === 12) {
      month = 0;
      year++;
    }
  }
  return ticks;
}
