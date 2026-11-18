import type { MonthTick } from '../data/timeline';
import { el } from './dom';

export interface TimelineBarHandlers {
  onToggle(): void;
  /** The user moved the scrubber to this many days after the start. */
  onScrub(dayOffset: number): void;
}

export interface TimelineBarState {
  dayOffset: number;
  /** "Nov 2026" */
  month: string;
  /** "Nov 18, 2026", used for screen readers. */
  fullDate: string;
  count: number;
  total: number;
  playing: boolean;
  atEnd: boolean;
}

export interface TimelineBar {
  element: HTMLElement;
  set(state: TimelineBarState): void;
}

const ICON_PLAY = 'M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z';
const ICON_PAUSE = 'M7.5 5h2.2a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H7.5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm6.8 0h2.2a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-2.2a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z';
const ICON_REPLAY = 'M12 5a7 7 0 1 1-6.6 4.67 1 1 0 1 1 1.88.66A5 5 0 1 0 12 7v2.1a.6.6 0 0 1-.98.46L7.4 6.6a.6.6 0 0 1 0-.92l3.62-2.96A.6.6 0 0 1 12 3.2V5Z';

export function createTimelineBar(spanDays: number, ticks: MonthTick[], handlers: TimelineBarHandlers): TimelineBar {
  const element = el('section', 'glass timeline', undefined, { 'aria-label': 'Timeline' });

  const play = el('button', 'timeline-play', undefined, { type: 'button', 'aria-label': 'Play' });
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('aria-hidden', 'true');
  const iconPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  icon.append(iconPath);
  play.append(icon);
  play.addEventListener('click', () => handlers.onToggle());

  const month = el('output', 'timeline-month', '', { 'aria-live': 'off' });
  const count = el('div', 'timeline-count');
  const countValue = el('span', 'timeline-count-value', '0');
  const countLabel = el('span', 'timeline-count-label', 'nodes');
  count.append(countValue, countLabel);

  const track = el('div', 'timeline-track');
  const range = el('input', 'timeline-range', undefined, {
    type: 'range',
    min: '0',
    max: String(Math.max(1, spanDays)),
    step: '1',
    value: '0',
    'aria-label': 'Timeline date',
  });
  if (spanDays <= 0) range.disabled = true;
  range.addEventListener('input', () => handlers.onScrub(Number(range.value)));

  const tickRow = el('div', 'timeline-ticks', undefined, { 'aria-hidden': 'true' });
  for (const tick of ticks) {
    const mark = el('span', 'timeline-tick', tick.label);
    mark.style.setProperty('--at', String(tick.fraction));
    tickRow.append(mark);
  }
  track.append(range, tickRow);

  element.append(play, month, track, count);

  let lastIcon = '';
  return {
    element,
    set(state) {
      range.value = String(state.dayOffset);
      range.style.setProperty('--progress', String(spanDays > 0 ? state.dayOffset / spanDays : 1));
      range.setAttribute('aria-valuetext', `${state.fullDate}, ${state.count} of ${state.total} nodes`);
      month.textContent = state.month;
      countValue.textContent = String(state.count);
      countLabel.textContent = state.count === 1 ? 'node' : 'nodes';

      const nextIcon = state.playing ? ICON_PAUSE : state.atEnd ? ICON_REPLAY : ICON_PLAY;
      if (nextIcon !== lastIcon) {
        lastIcon = nextIcon;
        iconPath.setAttribute('d', nextIcon);
        play.setAttribute('aria-label', state.playing ? 'Pause' : state.atEnd ? 'Replay' : 'Play');
      }
    },
  };
}
