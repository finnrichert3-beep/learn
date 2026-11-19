// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildNeighbours } from '../src/data/graph';
import { dayNumber } from '../src/data/timeline';
import type { GalaxyData } from '../src/data/types';
import { createDetailMode, type DetailMode } from '../src/detail/detailMode';
import type { GalaxyRenderer } from '../src/render/renderer';
import { AGAIN_DELAY_MS, DAY_MS } from '../src/review/scheduler';
import { STORAGE_KEY, type StorageLike } from '../src/review/store';

/**
 *   a0 --- a1 --- a2        cluster A (a0: 1 card, a1: 2 cards, a2: 1 card)
 *    \
 *     b0                    cluster B (no cards)
 */
const data: GalaxyData = {
  clusters: [
    { id: 'a', name: 'Alpha', color: '#4d8dff', group: 'School' },
    { id: 'b', name: 'Beta', color: '#ff7a3d', group: '' },
  ],
  nodes: [
    { id: 'a0', label: 'A zero', cluster: 'a', date: '2026-09-01', overview: 'First.', points: ['One'], cards: [{ q: 'Q a0', a: 'A a0' }] },
    {
      id: 'a1',
      label: 'A one',
      cluster: 'a',
      date: '2026-09-05',
      cards: [
        { q: 'Q a1 first', a: 'A a1 first' },
        { q: 'Q a1 second', a: 'A a1 second' },
      ],
    },
    { id: 'a2', label: 'A two', cluster: 'a', date: '2026-09-10', cards: [{ q: 'Q a2', a: 'A a2' }] },
    { id: 'b0', label: 'B zero', cluster: 'b', date: '2026-09-03' },
  ],
  links: [
    ['a0', 'a1'],
    ['a1', 'a2'],
    ['a0', 'b0'],
  ],
};
const ALL = [true, true, true, true];
const START = Date.UTC(2026, 10, 19, 12, 0, 0);

interface Harness {
  mode: DetailMode;
  renderer: { setFocus: ReturnType<typeof vi.fn>; flyToNode: ReturnType<typeof vi.fn>; flyHome: ReturnType<typeof vi.fn> };
  storage: StorageLike & { data: Record<string, string>; fail: boolean };
  clock: { now: number };
  opened: boolean[];
  dueCalls: boolean[][];
  panel: HTMLElement;
  text(selector: string): string | null;
  click(focusKey: string): void;
}

function setup(options: { failStorage?: boolean } = {}): Harness {
  document.body.innerHTML = '<input id="outside" />';
  const renderer = { setFocus: vi.fn(), flyToNode: vi.fn(), flyHome: vi.fn() };
  const storage = {
    data: {} as Record<string, string>,
    fail: options.failStorage ?? false,
    getItem(key: string) {
      if (this.fail) throw new Error('blocked');
      return this.data[key] ?? null;
    },
    setItem(key: string, value: string) {
      if (this.fail) throw new Error('blocked');
      this.data[key] = value;
    },
  };
  const clock = { now: START };
  const opened: boolean[] = [];
  const dueCalls: boolean[][] = [];
  const mode = createDetailMode({
    data,
    days: data.nodes.map((node) => dayNumber(node.date)),
    neighbours: buildNeighbours(data),
    nodeCluster: [0, 0, 0, 1],
    renderer: renderer as unknown as GalaxyRenderer,
    onOpenChange: (open) => opened.push(open),
    onDueChange: (due) => dueCalls.push([...due]),
    now: () => clock.now,
    storage,
  });
  const panel = mode.panel.element;
  document.body.append(panel);
  return {
    mode,
    renderer,
    storage,
    clock,
    opened,
    dueCalls,
    panel,
    text: (selector) => panel.querySelector(selector)?.textContent ?? null,
    click(focusKey) {
      const target = panel.querySelector<HTMLElement>(`[data-focus="${focusKey}"]`);
      if (!target) throw new Error(`no control "${focusKey}" in the panel`);
      target.click();
    },
  };
}

const focusKey = (): string | undefined => (document.activeElement as HTMLElement | null)?.dataset?.focus;
const saved = (h: Harness): Record<string, { interval: number; due: number; reviews: number }> => JSON.parse(h.storage.data[STORAGE_KEY] ?? '{}');
const key = (name: string): KeyboardEvent => new KeyboardEvent('keydown', { key: name });

let h: Harness;
beforeEach(() => {
  h = setup();
  h.mode.setVisible(ALL);
});

describe('opening a node', () => {
  it('shows its details and focuses the galaxy on it and its neighbours', () => {
    h.mode.open(0);
    expect(h.mode.isOpen).toBe(true);
    expect(h.opened).toEqual([true]);
    expect(h.text('.detail-title')).toBe('A zero');
    expect(h.text('.detail-kicker')).toBe('Alpha · School');
    expect(h.text('.detail-overview')).toBe('First.');
    expect(h.renderer.setFocus).toHaveBeenLastCalledWith(0, [1, 3]);
    expect(h.renderer.flyToNode).toHaveBeenLastCalledWith(0, [1, 3], -1);
    expect(focusKey()).toBe('title');
  });

  it('lists connected skills grouped by cluster, own cluster first, with counts', () => {
    h.mode.open(0);
    const groups = [...h.panel.querySelectorAll('.connected-group')].map((head) => [
      head.querySelector('.connected-cluster')?.textContent,
      head.querySelector('.connected-count')?.textContent,
    ]);
    expect(groups).toEqual([
      ['Alpha', '1'],
      ['Beta', '1'],
    ]);
    expect([...h.panel.querySelectorAll('.detail-heading')].map((e) => e.textContent)).toContain('Connected skills · 2');
  });

  it('hides Review for a node without cards and shows a hint when there are no notes', () => {
    h.mode.open(3);
    expect(h.panel.querySelector('[data-focus="review"]')).toBeNull();
    expect(h.panel.querySelector('[data-focus="explore"]')).not.toBeNull();
    expect(h.text('.detail-empty')).toContain('No notes yet');
  });

  it('jumps to a connected skill, and closes back to the galaxy', () => {
    h.mode.open(0);
    h.click('link-1');
    expect(h.mode.focus).toBe(1);
    expect(h.text('.detail-title')).toBe('A one');
    h.mode.close();
    expect(h.mode.isOpen).toBe(false);
    expect(h.renderer.setFocus).toHaveBeenLastCalledWith(-1);
    expect(h.renderer.flyHome).toHaveBeenCalledTimes(1);
    expect(h.opened).toEqual([true, false]);
  });

  it('will not open a node the timeline is hiding', () => {
    h.mode.setVisible([true, false, true, true]);
    h.mode.open(1);
    expect(h.mode.isOpen).toBe(false);
  });
});

describe('the timeline moving while a node is open', () => {
  it('leaves keyboard focus where it is', () => {
    h.mode.open(0);
    const outside = document.getElementById('outside') as HTMLInputElement;
    outside.focus();
    h.mode.setVisible(ALL);
    expect(document.activeElement).toBe(outside);
    // A day that does change the panel: b0 disappears.
    h.mode.setVisible([true, true, true, false]);
    expect(document.activeElement).toBe(outside);
    expect([...h.panel.querySelectorAll('.detail-heading')].map((e) => e.textContent)).toContain('Connected skills · 1');
    expect(h.renderer.setFocus).toHaveBeenLastCalledWith(0, [1]);
  });

  it('does not rebuild the panel when nothing it shows has changed', () => {
    h.mode.open(0);
    h.mode.setVisible(ALL);
    const title = h.panel.querySelector('.detail-title');
    h.mode.setVisible([true, true, false, true]); // a2 is not linked to a0
    expect(h.panel.querySelector('.detail-title')).toBe(title);
  });

  it('closes when the open node itself disappears', () => {
    h.mode.open(1);
    h.mode.setVisible([true, false, true, true]);
    expect(h.mode.isOpen).toBe(false);
  });

  it('ends a tour whose route lost a stop, but keeps the node open', () => {
    h.mode.open(0);
    h.click('explore');
    expect(h.mode.state()).toMatchObject({ view: 'explore', tour: { step: 0, path: ['a0', 'a1', 'a2'] } });
    h.mode.setVisible([true, true, false, true]);
    expect(h.mode.state()).toMatchObject({ view: 'detail', focus: 'a0' });
  });

  it('ends a cluster review rather than show cards for nodes that are no longer on screen', () => {
    h.mode.open(0);
    h.click('review');
    h.click('scope-cluster');
    expect(h.mode.state()).toMatchObject({ view: 'review', review: { scope: 'cluster', total: 4 } });
    h.mode.setVisible([true, true, false, true]);
    expect(h.mode.state()).toMatchObject({ view: 'detail', focus: 'a0', review: null });
  });
});

describe('Explore', () => {
  it('steps along the route with Next and Back, flying along each link', () => {
    h.mode.open(0);
    h.click('explore');
    expect(h.text('.tour-count')).toBe('1 of 3');
    expect(h.text('.tour-next-label')).toBe('A one');
    // As a keyboard user would: Next has focus, then Enter activates it.
    h.panel.querySelector<HTMLElement>('[data-focus="next"]')?.focus();
    h.click('next');
    expect(h.mode.focus).toBe(1);
    expect(h.renderer.flyToNode).toHaveBeenLastCalledWith(1, [0, 2], 0);
    expect(focusKey()).toBe('next');
    h.click('next');
    expect(h.text('.tour-count')).toBe('3 of 3');
    expect(h.text('[data-focus="next"]')).toBe('Finish');
    h.click('back');
    expect(h.mode.focus).toBe(1);
    expect(h.renderer.flyToNode).toHaveBeenLastCalledWith(1, [0, 2], 2);
  });

  it('shows the connected skills at each stop and marks the next one', () => {
    h.mode.open(0);
    h.click('explore');
    expect(h.panel.querySelectorAll('.detail-link')).toHaveLength(2);
    expect(h.panel.querySelector('.detail-link-tag')?.parentElement?.dataset.focus).toBe('link-1');
  });

  it('clicking the next stop in the list is the same as Next; any other skill leaves the tour', () => {
    h.mode.open(0);
    h.click('explore');
    h.click('link-1');
    expect(h.mode.state()).toMatchObject({ view: 'explore', focus: 'a1', tour: { step: 1 } });
    h.click('link-0'); // the previous stop
    expect(h.mode.state()).toMatchObject({ view: 'explore', focus: 'a0', tour: { step: 0 } });
    h.click('link-3'); // not on the route
    expect(h.mode.state()).toMatchObject({ view: 'detail', focus: 'b0', tour: null });
  });

  it('arrow keys step, Finish returns to the skill, Esc returns to the galaxy', () => {
    h.mode.open(0);
    h.click('explore');
    expect(h.mode.handleKey(key('ArrowRight'))).toBe(true);
    expect(h.mode.handleKey(key('ArrowRight'))).toBe(true);
    expect(h.mode.focus).toBe(2);
    h.click('next'); // Finish
    expect(h.mode.state()).toMatchObject({ view: 'detail', focus: 'a2' });
    h.click('explore');
    expect(h.mode.handleKey(key('Escape'))).toBe(true);
    expect(h.mode.isOpen).toBe(false);
  });
});

describe('Review', () => {
  it('question, reveal, grade, done: and the schedule is saved', () => {
    h.mode.open(0);
    h.click('review');
    expect(h.text('.card-question')).toBe('Q a0');
    expect(h.panel.querySelector('.card-answer')).toBeNull();
    expect(h.panel.querySelector('.grades')).toBeNull();
    expect(focusKey()).toBe('reveal');
    h.click('reveal');
    expect(h.text('.card-answer')).toBe('A a0');
    expect(h.text('[role="status"]')).toBe('Answer: A a0');
    expect([...h.panel.querySelectorAll('.grade-hint')].map((e) => e.textContent)).toEqual(['10 min', '1 day', '4 days']);
    expect(focusKey()).toBe('grade-good');
    h.click('grade-good');
    expect(h.mode.state()).toMatchObject({ view: 'reviewDone' });
    expect(h.text('.detail-overview')).toContain('1 skill reviewed. Progress is saved in this browser.');
    expect(saved(h)['a0']).toMatchObject({ interval: 1, due: START + DAY_MS, reviews: 1 });
    h.click('exit-review');
    expect(h.mode.state()).toMatchObject({ view: 'detail', focus: 'a0' });
    expect(h.text('.detail-chip')).toBe('Next review in 1 day');
  });

  it('a card that comes back after Again is a practice round and promises no date', () => {
    h.mode.open(0);
    h.click('review');
    h.click('reveal');
    h.click('grade-again');
    expect(saved(h)['a0']).toMatchObject({ interval: 0, due: START + AGAIN_DELAY_MS });
    h.click('reveal');
    expect(h.text('.review-note')).toContain('Practice round');
    expect([...h.panel.querySelectorAll('.grade-hint')].map((e) => e.textContent)).toEqual(['once more', 'got it', 'got it']);
    h.click('grade-easy');
    expect(h.mode.state()).toMatchObject({ view: 'reviewDone' });
    expect(saved(h)['a0']).toMatchObject({ interval: 0, due: START + AGAIN_DELAY_MS, reviews: 1 });
    expect(h.text('.review-summary-next')).toBe('in 10 min');
  });

  it('hints follow the weakest-card rule: after one Again, every grade on the next card says 10 min', () => {
    h.mode.open(1);
    h.click('review');
    h.click('reveal');
    h.click('grade-again');
    h.click('reveal');
    expect(h.text('.card-question')).toBe('Q a1 second');
    expect([...h.panel.querySelectorAll('.grade-hint')].map((e) => e.textContent)).toEqual(['10 min', '10 min', '10 min']);
    h.click('grade-easy');
    expect(saved(h)['a1']).toMatchObject({ interval: 0, due: START + AGAIN_DELAY_MS });
  });

  it('going through the same node again straight away does not push its date out', () => {
    h.mode.open(0);
    for (let round = 0; round < 3; round++) {
      h.click('review');
      h.click('reveal');
      expect(h.text('.grade-good .grade-hint')).toBe('1 day');
      h.click('grade-good');
      h.click('exit-review');
      h.clock.now += 60_000;
    }
    expect(saved(h)['a0']).toMatchObject({ interval: 1, due: START + DAY_MS, reviews: 3 });
  });

  it('whole cluster: every node with cards, and the galaxy follows the card', () => {
    h.mode.open(0);
    h.click('review');
    h.click('scope-cluster');
    expect([...h.panel.querySelectorAll('.segmented-count')].map((e) => e.textContent)).toEqual(['1', '4']);
    h.click('reveal');
    h.click('grade-good');
    expect(h.mode.state()).toMatchObject({ focus: 'a1', review: { node: 'a1', index: 2, total: 4 } });
    expect(h.renderer.flyToNode).toHaveBeenLastCalledWith(1, [0, 2], -1);
  });

  it('keys: 1-3 grade only once the answer is showing; Esc goes back to the skill, then closes', () => {
    h.mode.open(0);
    h.click('review');
    expect(h.mode.handleKey(key('2'))).toBe(false);
    h.click('reveal');
    expect(h.mode.handleKey(key('3'))).toBe(true);
    expect(saved(h)['a0']).toMatchObject({ interval: 4 });
    h.mode.open(1);
    h.click('review');
    expect(h.mode.handleKey(key('Escape'))).toBe(true);
    expect(h.mode.state()).toMatchObject({ view: 'detail', focus: 'a1' });
    expect(h.mode.handleKey(key('Escape'))).toBe(true);
    expect(h.mode.isOpen).toBe(false);
    expect(h.mode.handleKey(key('Escape'))).toBe(false);
  });

  it('says so when the browser refuses to store progress, and keeps working', () => {
    h = setup({ failStorage: true });
    h.mode.setVisible(ALL);
    h.mode.open(0);
    h.click('review');
    h.click('reveal');
    h.click('grade-good');
    expect(h.text('.detail-overview')).toContain('blocking storage');
    h.click('exit-review');
    expect(h.text('.detail-chip')).toBe('Next review in 1 day');
  });
});

describe('due for review', () => {
  it('reports due nodes as time passes and updates the open panel', () => {
    h.mode.open(0);
    h.click('review');
    h.click('reveal');
    h.click('grade-again');
    h.click('reveal');
    h.click('grade-good');
    h.click('exit-review');
    expect(h.text('.detail-chip')).toBe('Next review in 10 min');
    expect(h.dueCalls).toEqual([]);

    const outside = document.getElementById('outside') as HTMLInputElement;
    outside.focus();
    h.clock.now += AGAIN_DELAY_MS + 1000;
    h.mode.refreshDue();
    expect(h.dueCalls).toEqual([[true, false, false, false]]);
    expect(h.text('.detail-chip')).toBe('Due for review');
    expect(document.activeElement).toBe(outside);
    expect((h.mode.state() as { due: string[] }).due).toEqual(['a0']);
  });

  it('loads saved progress on start-up and ignores saved state for nodes that have no cards', () => {
    const past = { interval: 1, ease: 2.5, due: START - 1000, last: START - DAY_MS, reviews: 1 };
    h = setup();
    h.storage.data[STORAGE_KEY] = JSON.stringify({ a2: past, b0: past, gone: past });
    const again = createDetailMode({
      data,
      days: data.nodes.map((node) => dayNumber(node.date)),
      neighbours: buildNeighbours(data),
      nodeCluster: [0, 0, 0, 1],
      renderer: h.renderer as unknown as GalaxyRenderer,
      onOpenChange: () => undefined,
      onDueChange: (due) => h.dueCalls.push([...due]),
      now: () => START,
      storage: h.storage,
    });
    expect(h.dueCalls).toEqual([[false, false, true, false]]);
    expect((again.state() as { due: string[] }).due).toEqual(['a2']);
  });
});
