import type { Grade } from '../review/scheduler';
import { el } from './dom';

export interface LinkedItem {
  index: number;
  label: string;
  cluster: string;
  color: string;
}

/** Everything the panel shows about one node. */
export interface NodeView {
  index: number;
  label: string;
  cluster: string;
  group: string;
  color: string;
  /** "Sep 2, 2026" */
  date: string;
  overview?: string;
  points: readonly string[];
  linked: LinkedItem[];
  cardCount: number;
  /** "Not reviewed yet", "Due for review", "Next review in 3 days". Empty when the node has no cards. */
  reviewStatus: string;
  reviewDue: boolean;
  canExplore: boolean;
}

export type ReviewScope = 'node' | 'cluster';

export type PanelView =
  | { kind: 'detail'; node: NodeView }
  | { kind: 'explore'; node: NodeView; step: number; total: number; nextLabel: string | null }
  | {
      kind: 'review';
      node: NodeView;
      scope: ReviewScope;
      /** Cards in "this topic" and in the whole cluster, for the scope switch. */
      scopeCards: Record<ReviewScope, number>;
      question: string;
      answer: string;
      revealed: boolean;
      index: number;
      total: number;
      /** How far away each grade would push the next review, e.g. "3 days". */
      hints: Record<Grade, string>;
    }
  | { kind: 'reviewDone'; node: NodeView; scope: ReviewScope; lines: Array<{ label: string; next: string }>; more: number };

export interface DetailPanelHandlers {
  onClose(): void;
  onJump(index: number): void;
  onExplore(): void;
  onReview(): void;
  onStep(direction: 1 | -1): void;
  onExitExplore(): void;
  onReveal(): void;
  onGrade(grade: Grade): void;
  onScope(scope: ReviewScope): void;
  onExitReview(): void;
}

export interface DetailPanel {
  element: HTMLElement;
  show(view: PanelView): void;
  hide(): void;
  readonly isOpen: boolean;
}

const ICONS = {
  close: 'M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12 19 6.4 17.6 5 12 10.6 6.4 5Z',
  explore: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 2a7 7 0 1 1 0 14 7 7 0 0 1 0-14Zm3.9 3.1-5.3 2.5-2.5 5.3 5.3-2.5 2.5-5.3ZM12 11a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z',
  review: 'M5 4h11a2 2 0 0 1 2 2v1h1a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-1H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm3 13v1h11V9h-1v6a2 2 0 0 1-2 2H8ZM5 6v9h11V6H5Z',
  next: 'M13.2 5.3 11.8 6.7l4.3 4.3H4v2h12.1l-4.3 4.3 1.4 1.4L19.9 12l-6.7-6.7Z',
  back: 'M10.8 5.3 12.2 6.7 7.9 11H20v2H7.9l4.3 4.3-1.4 1.4L4.1 12l6.7-6.7Z',
};

const GRADES: Array<{ grade: Grade; label: string; key: string }> = [
  { grade: 'again', label: 'Again', key: '1' },
  { grade: 'good', label: 'Good', key: '2' },
  { grade: 'easy', label: 'Easy', key: '3' },
];

function icon(path: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  shape.setAttribute('d', path);
  svg.append(shape);
  return svg;
}

/** The side panel (bottom sheet on phones) for a node's details, the Explore tour and Review cards. */
export function createDetailPanel(handlers: DetailPanelHandlers): DetailPanel {
  const element = el('aside', 'glass detail', undefined, { 'aria-label': 'Topic details', 'aria-hidden': 'true' });
  element.inert = true;

  const head = el('header', 'detail-head');
  const dot = el('span', 'detail-dot');
  const kicker = el('span', 'detail-kicker');
  const close = el('button', 'detail-close', undefined, { type: 'button', 'aria-label': 'Close and show the whole galaxy', title: 'Close (Esc)' });
  close.append(icon(ICONS.close));
  close.addEventListener('click', () => handlers.onClose());
  head.append(dot, kicker, close);

  const body = el('div', 'detail-body');
  element.append(head, body);

  let open = false;
  let lastKey = '';

  /** A button that remembers a name, so focus can return to "the same" button after a re-render. */
  const button = (className: string, focusKey: string, onClick: () => void, label?: string): HTMLButtonElement => {
    const node = el('button', className, label, { type: 'button', 'data-focus': focusKey });
    node.addEventListener('click', onClick);
    return node;
  };

  const titleBlock = (node: NodeView): HTMLElement[] => {
    const title = el('h2', 'detail-title', node.label, { tabindex: '-1', 'data-focus': 'title' });
    const meta = el('p', 'detail-meta');
    meta.append(el('span', undefined, `Added ${node.date}`));
    if (node.reviewStatus !== '') {
      meta.append(el('span', node.reviewDue ? 'detail-chip is-due' : 'detail-chip', node.reviewStatus));
    }
    return [title, meta];
  };

  const notes = (node: NodeView): HTMLElement[] => {
    const parts: HTMLElement[] = [];
    if (node.overview) {
      parts.push(el('p', 'detail-overview', node.overview));
    } else {
      parts.push(el('p', 'detail-empty', 'No notes yet. Add an "overview" to this node in galaxy.json.'));
    }
    if (node.points.length > 0) {
      const list = el('ul', 'detail-points');
      for (const point of node.points) list.append(el('li', undefined, point));
      parts.push(el('h3', 'detail-heading', 'Key points'), list);
    }
    return parts;
  };

  const renderDetail = (node: NodeView): void => {
    body.append(...titleBlock(node), ...notes(node));

    const actions = el('div', 'detail-actions');
    if (node.canExplore) {
      const explore = button('detail-action', 'explore', handlers.onExplore);
      explore.append(icon(ICONS.explore), el('span', undefined, 'Explore'));
      actions.append(explore);
    }
    if (node.cardCount > 0) {
      const review = button('detail-action', 'review', handlers.onReview);
      review.append(icon(ICONS.review), el('span', undefined, 'Review'), el('span', 'detail-action-count', String(node.cardCount)));
      review.setAttribute('aria-label', `Review, ${node.cardCount} ${node.cardCount === 1 ? 'card' : 'cards'}`);
      actions.append(review);
    }
    if (actions.childElementCount > 0) body.append(actions);

    if (node.linked.length > 0) {
      body.append(el('h3', 'detail-heading', `Linked topics · ${node.linked.length}`));
      const list = el('ul', 'detail-links');
      for (const item of node.linked) {
        const row = button('detail-link', `link-${item.index}`, () => handlers.onJump(item.index));
        const itemDot = el('span', 'detail-dot');
        itemDot.style.setProperty('--dot', item.color);
        row.append(itemDot, el('span', 'detail-link-label', item.label), el('span', 'detail-link-cluster', item.cluster));
        const entry = el('li');
        entry.append(row);
        list.append(entry);
      }
      body.append(list);
    }
  };

  const renderExplore = (view: Extract<PanelView, { kind: 'explore' }>): void => {
    const tour = el('div', 'tour');
    const top = el('div', 'tour-top');
    top.append(el('span', 'tour-name', 'Explore'), el('span', 'tour-count', `${view.step + 1} of ${view.total}`));
    const track = el('div', 'tour-track', undefined, { 'aria-hidden': 'true' });
    for (let i = 0; i < view.total; i++) track.append(el('span', i <= view.step ? 'is-done' : ''));
    tour.append(top, track);
    body.append(tour, ...titleBlock(view.node), ...notes(view.node));

    const nav = el('div', 'tour-nav');
    const back = button('tour-button', 'back', () => handlers.onStep(-1));
    back.append(icon(ICONS.back), el('span', undefined, 'Back'));
    back.disabled = view.step === 0;
    const next = button('tour-button is-primary', 'next', () => (view.nextLabel === null ? handlers.onExitExplore() : handlers.onStep(1)));
    if (view.nextLabel === null) {
      next.append(el('span', undefined, 'Finish'));
    } else {
      const text = el('span', 'tour-next-text');
      text.append(el('span', 'tour-next-word', 'Next'), el('span', 'tour-next-label', view.nextLabel));
      next.append(text, icon(ICONS.next));
      next.setAttribute('aria-label', `Next: ${view.nextLabel}`);
    }
    nav.append(back, next);
    body.append(nav, button('detail-text-button', 'exit-explore', handlers.onExitExplore, 'Exit tour'));
  };

  const scopeSwitch = (view: { scope: ReviewScope; node: NodeView; scopeCards: Record<ReviewScope, number> }): HTMLElement => {
    const group = el('div', 'segmented', undefined, { role: 'group', 'aria-label': 'What to review' });
    const options: Array<{ scope: ReviewScope; label: string }> = [
      { scope: 'node', label: 'This topic' },
      { scope: 'cluster', label: 'Whole cluster' },
    ];
    for (const option of options) {
      const choice = button('segmented-option', `scope-${option.scope}`, () => handlers.onScope(option.scope));
      choice.append(el('span', undefined, option.label), el('span', 'segmented-count', String(view.scopeCards[option.scope])));
      choice.setAttribute('aria-pressed', String(view.scope === option.scope));
      group.append(choice);
    }
    return group;
  };

  const renderReview = (view: Extract<PanelView, { kind: 'review' }>): void => {
    body.append(scopeSwitch(view));
    const progress = el('p', 'review-progress');
    progress.append(el('span', undefined, `Card ${view.index} of ${view.total}`), el('span', 'review-topic', view.node.label));
    body.append(progress);

    const face = view.revealed ? el('div', 'card is-revealed') : button('card', 'reveal', handlers.onReveal);
    face.append(el('span', 'card-side', 'Question'), el('p', 'card-question', view.question));
    if (view.revealed) {
      face.append(el('span', 'card-side', 'Answer'), el('p', 'card-answer', view.answer));
      face.setAttribute('aria-live', 'polite');
    } else {
      face.append(el('span', 'card-hint', 'Tap to reveal the answer'));
    }
    body.append(face);

    if (view.revealed) {
      const grades = el('div', 'grades', undefined, { role: 'group', 'aria-label': 'How well did you know it?' });
      for (const { grade, label, key } of GRADES) {
        const choice = button(`grade grade-${grade}`, `grade-${grade}`, () => handlers.onGrade(grade));
        choice.append(el('span', 'grade-label', label), el('span', 'grade-hint', view.hints[grade]));
        choice.setAttribute('aria-label', `${label}: review again in ${view.hints[grade]}`);
        choice.title = `${label} (press ${key})`;
        grades.append(choice);
      }
      body.append(grades);
    }
    body.append(button('detail-text-button', 'exit-review', handlers.onExitReview, 'Back to topic'));
  };

  const renderReviewDone = (view: Extract<PanelView, { kind: 'reviewDone' }>): void => {
    body.append(el('h2', 'detail-title', 'Review done', { tabindex: '-1', 'data-focus': 'title' }));
    const count = view.lines.length + view.more;
    body.append(el('p', 'detail-overview', `${count} ${count === 1 ? 'topic' : 'topics'} reviewed. Progress is saved in this browser.`));
    const list = el('ul', 'review-summary');
    for (const line of view.lines) {
      const row = el('li');
      row.append(el('span', 'review-summary-label', line.label), el('span', 'review-summary-next', line.next));
      list.append(row);
    }
    body.append(list);
    if (view.more > 0) body.append(el('p', 'detail-empty', `…and ${view.more} more.`));
    const done = button('tour-button is-primary is-wide', 'exit-review', handlers.onExitReview);
    done.append(el('span', undefined, 'Back to topic'));
    body.append(done);
  };

  return {
    element,
    get isOpen() {
      return open;
    },
    show(view) {
      // What had focus before the re-render, so it can go back to the matching control.
      const active = document.activeElement;
      const previousFocus = active instanceof HTMLElement && element.contains(active) ? (active.dataset.focus ?? '') : '';
      const key = `${view.kind}:${view.node.index}`;
      const sameScreen = key === lastKey;
      lastKey = key;

      dot.style.setProperty('--dot', view.node.color);
      kicker.textContent = view.node.group === '' ? view.node.cluster : `${view.node.cluster} · ${view.node.group}`;
      element.dataset.view = view.kind;
      element.style.setProperty('--accent', view.node.color);

      const scroll = sameScreen ? body.scrollTop : 0;
      body.replaceChildren();
      if (view.kind === 'detail') renderDetail(view.node);
      else if (view.kind === 'explore') renderExplore(view);
      else if (view.kind === 'review') renderReview(view);
      else renderReviewDone(view);
      body.scrollTop = scroll;

      open = true;
      element.inert = false;
      element.classList.add('is-open');
      element.setAttribute('aria-hidden', 'false');

      // Keyboard focus: stay on the same control when the screen only updated (Next, Back,
      // the scope switch); otherwise start at the top, or on the card's main button.
      const fallback = view.kind === 'review' ? (view.revealed ? 'grade-good' : 'reveal') : 'title';
      const keep = sameScreen || (view.kind === 'explore' && (previousFocus === 'next' || previousFocus === 'back'));
      const find = (name: string): HTMLElement | null => element.querySelector<HTMLElement>(`[data-focus="${name}"]:not(:disabled)`);
      const target = (keep && previousFocus !== '' ? find(previousFocus) : null) ?? find(fallback) ?? find('title');
      target?.focus({ preventScroll: true });
    },
    hide() {
      if (!open) return;
      open = false;
      lastKey = '';
      if (element.contains(document.activeElement) && document.activeElement instanceof HTMLElement) document.activeElement.blur();
      element.inert = true;
      element.classList.remove('is-open');
      element.setAttribute('aria-hidden', 'true');
    },
  };
}
