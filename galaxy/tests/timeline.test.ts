import { describe, expect, it } from 'vitest';
import {
  countVisible,
  dateLabel,
  dayAt,
  dayNumber,
  isVisibleAt,
  monthLabel,
  monthTicks,
  timelineRange,
  visibleMask,
} from '../src/data/timeline';

const dates = ['2026-08-17', '2026-09-01', '2026-09-30', '2026-10-01', '2026-11-18'];
const days = dates.map(dayNumber);

describe('dayNumber', () => {
  it('counts whole days', () => {
    expect(dayNumber('1970-01-01')).toBe(0);
    expect(dayNumber('1970-01-02')).toBe(1);
    expect(dayNumber('2026-09-01') - dayNumber('2026-08-31')).toBe(1);
    expect(dayNumber('2026-11-18') - dayNumber('2026-08-17')).toBe(93);
  });
});

describe('labels', () => {
  it('formats month and year', () => {
    expect(monthLabel(dayNumber('2026-11-18'))).toBe('Nov 2026');
    expect(monthLabel(dayNumber('2026-08-31'))).toBe('Aug 2026');
    expect(monthLabel(dayNumber('2026-09-01'))).toBe('Sep 2026');
    expect(monthLabel(dayNumber('2027-01-01'))).toBe('Jan 2027');
  });

  it('formats a full date', () => {
    expect(dateLabel(dayNumber('2026-11-08'))).toBe('Nov 8, 2026');
  });
});

describe('timelineRange', () => {
  it('spans the earliest to the latest node, in any order', () => {
    const shuffled = [days[3], days[0], days[4], days[1]].filter((d): d is number => d !== undefined);
    expect(timelineRange(shuffled)).toEqual({ start: dayNumber('2026-08-17'), end: dayNumber('2026-11-18') });
  });

  it('handles a single node and no nodes', () => {
    expect(timelineRange([42])).toEqual({ start: 42, end: 42 });
    expect(timelineRange([])).toEqual({ start: 0, end: 0 });
  });
});

describe('filtering by date', () => {
  it('shows a node on its own date, not the day before', () => {
    const day = dayNumber('2026-09-30');
    expect(isVisibleAt(day, day - 1)).toBe(false);
    expect(isVisibleAt(day, day)).toBe(true);
    expect(isVisibleAt(day, day + 1)).toBe(true);
  });

  it('builds a mask in node order', () => {
    expect(visibleMask(days, dayNumber('2026-09-30'))).toEqual([true, true, true, false, false]);
    expect(visibleMask(days, dayNumber('2026-08-16'))).toEqual([false, false, false, false, false]);
    expect(visibleMask(days, dayNumber('2026-12-25'))).toEqual([true, true, true, true, true]);
  });

  it('counts exactly the nodes in the mask at every day of the range', () => {
    const range = timelineRange(days);
    for (let day = range.start; day <= range.end; day++) {
      const mask = visibleMask(days, day);
      expect(countVisible(days, day)).toBe(mask.filter(Boolean).length);
    }
    expect(countVisible(days, range.start)).toBe(1);
    expect(countVisible(days, range.end)).toBe(days.length);
  });

  it('never loses nodes as time moves forward', () => {
    const range = timelineRange(days);
    let previous = 0;
    for (let day = range.start; day <= range.end; day++) {
      const count = countVisible(days, day);
      expect(count).toBeGreaterThanOrEqual(previous);
      previous = count;
    }
  });
});

describe('dayAt', () => {
  const range = timelineRange(days);

  it('floors a playback position to a whole day', () => {
    expect(dayAt(range, range.start + 3.99)).toBe(range.start + 3);
  });

  it('clamps to the range', () => {
    expect(dayAt(range, range.start - 10)).toBe(range.start);
    expect(dayAt(range, range.end + 10)).toBe(range.end);
  });
});

describe('monthTicks', () => {
  it('marks each month boundary inside the range', () => {
    const ticks = monthTicks(timelineRange(days));
    expect(ticks.map((tick) => tick.label)).toEqual(['Sep', 'Oct', 'Nov']);
    expect(ticks[0]?.fraction).toBeCloseTo(15 / 93);
    for (const tick of ticks) {
      expect(tick.fraction).toBeGreaterThan(0);
      expect(tick.fraction).toBeLessThan(1);
    }
  });

  it('is empty for a single-day range', () => {
    expect(monthTicks({ start: 10, end: 10 })).toEqual([]);
  });
});
