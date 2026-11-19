import { dateLabel, dayNumber } from '../data/timeline';
import type { GalaxyData } from '../data/types';
import { explorePath } from '../explore/path';
import type { GalaxyRenderer } from '../render/renderer';
import { formatSpan, isDue, schedule, statusOf, type Grade } from '../review/scheduler';
import { ReviewSession } from '../review/session';
import { loadStore, saveStore, type ReviewStore } from '../review/store';
import { createDetailPanel, type DetailPanel, type NodeView, type PanelView, type ReviewScope } from '../ui/detailPanel';

export interface DetailModeOptions {
  data: GalaxyData;
  /** Day number of each node's date. */
  days: readonly number[];
  /** Linked node indices for each node. */
  neighbours: readonly (readonly number[])[];
  /** Cluster index of each node. */
  nodeCluster: readonly number[];
  renderer: GalaxyRenderer;
  /** Called when the panel opens or closes, so the page can make room for it. */
  onOpenChange(open: boolean): void;
  /** Called whenever the set of nodes due for review changes. */
  onDueChange(due: readonly boolean[]): void;
  /** Current time in ms. Injectable for tests. */
  now?: () => number;
}

export interface DetailMode {
  panel: DetailPanel;
  readonly isOpen: boolean;
  /** Node in focus, or -1. */
  readonly focus: number;
  /** Open a node's detail panel and move the camera to it. */
  open(node: number): void;
  /** Close everything. With `fly`, the camera returns to the whole galaxy. */
  close(fly?: boolean): void;
  /** A click on empty space: closes the plain detail view, but never interrupts a tour or a review. */
  dismiss(): void;
  /** Handle a key press. Returns true when the key was used. */
  handleKey(event: KeyboardEvent): boolean;
  /** The timeline moved: tell detail mode which nodes are on screen now. */
  setVisible(mask: readonly boolean[]): void;
  /** Re-check which nodes are due (time passes while the page is open). */
  refreshDue(): void;
  /** Snapshot for the debug hook. */
  state(): Record<string, unknown>;
}

const MAX_SUMMARY_LINES = 6;

/**
 * Detail mode: one node in focus with its panel, plus the two things you can start from
 * there, the Explore tour and the Review cards. Owns the review progress in localStorage.
 */
export function createDetailMode(options: DetailModeOptions): DetailMode {
  const { data, days, neighbours, nodeCluster, renderer } = options;
  const now = options.now ?? (() => Date.now());

  let visible: readonly boolean[] = data.nodes.map(() => true);
  let focus = -1;
  let tour: { path: number[]; step: number } | null = null;
  let review: { session: ReviewSession; scope: ReviewScope; origin: number } | null = null;
  let reviewDone: { scope: ReviewScope; origin: number; lines: Array<{ label: string; next: string }>; more: number } | null = null;

  const store: ReviewStore = loadStore();
  let due: boolean[] = data.nodes.map(() => false);

  const cardsOf = (node: number): number => data.nodes[node]?.cards?.length ?? 0;
  const visibleNeighbours = (node: number): number[] => (neighbours[node] ?? []).filter((other) => visible[other]);
  const routeFrom = (node: number): number[] => explorePath(node, neighbours, { allowed: visible, rank: days });

  const refreshDue = (): void => {
    const time = now();
    const next = data.nodes.map((node, index) => cardsOf(index) > 0 && isDue(store[node.id], time));
    const changed = next.some((value, index) => value !== due[index]);
    due = next;
    if (changed) options.onDueChange(due);
  };

  const viewOf = (node: number): NodeView => {
    const item = data.nodes[node]!;
    const cluster = data.clusters[nodeCluster[node] ?? 0];
    const cards = cardsOf(node);
    const time = now();
    const state = store[item.id];
    const status = statusOf(state, time);
    const reviewStatus =
      cards === 0
        ? ''
        : status === 'new'
          ? 'Not reviewed yet'
          : status === 'due'
            ? 'Due for review'
            : `Next review in ${formatSpan((state?.due ?? time) - time)}`;
    return {
      index: node,
      label: item.label,
      cluster: cluster?.name ?? '',
      group: cluster?.group ?? '',
      color: cluster?.color ?? '#ffffff',
      date: dateLabel(dayNumber(item.date)),
      ...(item.overview === undefined ? {} : { overview: item.overview }),
      points: item.points ?? [],
      linked: visibleNeighbours(node).map((other) => {
        const otherCluster = data.clusters[nodeCluster[other] ?? 0];
        return {
          index: other,
          label: data.nodes[other]?.label ?? '',
          cluster: otherCluster?.name ?? '',
          color: otherCluster?.color ?? '#ffffff',
        };
      }),
      cardCount: cards,
      reviewStatus,
      reviewDue: status === 'due' && cards > 0,
      canExplore: routeFrom(node).length > 1,
    };
  };

  /** Nodes to review for a scope, most urgent first: due, then never reviewed, then the rest. */
  const reviewItems = (origin: number, scope: ReviewScope): Array<{ node: number; cards: number }> => {
    if (scope === 'node') return [{ node: origin, cards: cardsOf(origin) }];
    const time = now();
    const urgency = (node: number): number => {
      const status = statusOf(store[data.nodes[node]!.id], time);
      return status === 'due' ? 0 : status === 'new' ? 1 : 2;
    };
    return data.nodes
      .map((_, node) => node)
      .filter((node) => nodeCluster[node] === nodeCluster[origin] && visible[node] && cardsOf(node) > 0)
      .sort((a, b) => urgency(a) - urgency(b) || a - b)
      .map((node) => ({ node, cards: cardsOf(node) }));
  };

  const countCards = (items: Array<{ cards: number }>): number => items.reduce((sum, item) => sum + item.cards, 0);

  const currentView = (): PanelView | null => {
    if (focus < 0) return null;
    if (reviewDone) {
      return { kind: 'reviewDone', node: viewOf(reviewDone.origin), scope: reviewDone.scope, lines: reviewDone.lines, more: reviewDone.more };
    }
    if (review) {
      const card = review.session.current;
      if (!card) return null;
      const item = data.nodes[card.node]!;
      const content = item.cards?.[card.card];
      const time = now();
      const hint = (grade: Grade): string => formatSpan(schedule(store[item.id], grade, time).due - time);
      return {
        kind: 'review',
        node: viewOf(card.node),
        scope: review.scope,
        scopeCards: {
          node: cardsOf(review.origin),
          cluster: countCards(reviewItems(review.origin, 'cluster')),
        },
        question: content?.q ?? '',
        answer: content?.a ?? '',
        revealed: review.session.revealed,
        ...review.session.progress,
        hints: { again: hint('again'), good: hint('good'), easy: hint('easy') },
      };
    }
    if (tour) {
      const next = tour.path[tour.step + 1];
      return {
        kind: 'explore',
        node: viewOf(focus),
        step: tour.step,
        total: tour.path.length,
        nextLabel: next === undefined ? null : (data.nodes[next]?.label ?? ''),
      };
    }
    return { kind: 'detail', node: viewOf(focus) };
  };

  const render = (): void => {
    const view = currentView();
    if (view) panel.show(view);
  };

  /** Move the focus (dimming, lit links, camera) to a node. `from` flies along the link from that node. */
  const focusOn = (node: number, from = -1): void => {
    const wasOpen = focus >= 0;
    focus = node;
    const bright = visibleNeighbours(node);
    renderer.setFocus(node, tour ? [...bright, ...tour.path] : bright);
    // Make room for the panel first, so the camera frames the node in the space that is left.
    if (!wasOpen) options.onOpenChange(true);
    renderer.flyToNode(node, bright, from);
  };

  const open = (node: number): void => {
    if (node < 0 || node >= data.nodes.length || !visible[node]) return;
    tour = null;
    review = null;
    reviewDone = null;
    focusOn(node);
    render();
  };

  const close = (fly = true): void => {
    if (focus < 0) return;
    focus = -1;
    tour = null;
    review = null;
    reviewDone = null;
    renderer.setFocus(-1);
    panel.hide();
    options.onOpenChange(false);
    if (fly) renderer.flyHome();
  };

  // ---- explore ---------------------------------------------------------------

  const startExplore = (): void => {
    if (focus < 0) return;
    const path = routeFrom(focus);
    if (path.length < 2) return;
    tour = { path, step: 0 };
    review = null;
    reviewDone = null;
    renderer.setFocus(focus, [...visibleNeighbours(focus), ...path]);
    render();
  };

  const stepExplore = (direction: 1 | -1): void => {
    if (!tour) return;
    const step = tour.step + direction;
    const node = tour.path[step];
    if (node === undefined) return;
    const from = focus;
    tour.step = step;
    focusOn(node, from);
    render();
  };

  const exitExplore = (): void => {
    if (!tour) return;
    tour = null;
    renderer.setFocus(focus, visibleNeighbours(focus));
    render();
  };

  // ---- review ----------------------------------------------------------------

  const startReview = (scope: ReviewScope, origin = focus): void => {
    if (origin < 0) return;
    const session = new ReviewSession(reviewItems(origin, scope));
    if (session.finished) return;
    tour = null;
    reviewDone = null;
    review = { session, scope, origin };
    followCard();
    render();
  };

  /** Keep the galaxy's focus on the node the current card belongs to. */
  const followCard = (): void => {
    const card = review?.session.current;
    if (card && card.node !== focus) focusOn(card.node);
    else if (card) renderer.setFocus(focus, visibleNeighbours(focus));
  };

  const gradeCard = (grade: Grade): void => {
    if (!review || !review.session.revealed) return;
    const result = review.session.answer(grade);
    if (result) {
      const id = data.nodes[result.node]!.id;
      store[id] = schedule(store[id], result.grade, now());
      saveStore(store);
      refreshDue();
    }
    if (review.session.finished) {
      const time = now();
      const lines = review.session.results.map(({ node }) => ({
        label: data.nodes[node]?.label ?? '',
        next: `in ${formatSpan((store[data.nodes[node]!.id]?.due ?? time) - time)}`,
      }));
      reviewDone = {
        scope: review.scope,
        origin: review.origin,
        lines: lines.slice(0, MAX_SUMMARY_LINES),
        more: Math.max(0, lines.length - MAX_SUMMARY_LINES),
      };
      const origin = review.origin;
      review = null;
      if (origin !== focus) focusOn(origin);
    } else {
      followCard();
    }
    render();
  };

  const exitReview = (): void => {
    const origin = review?.origin ?? reviewDone?.origin ?? focus;
    review = null;
    reviewDone = null;
    if (origin >= 0 && visible[origin]) open(origin);
    else close();
  };

  const panel = createDetailPanel({
    onClose: () => close(),
    onJump: (node) => open(node),
    onExplore: startExplore,
    onReview: () => startReview('node'),
    onStep: stepExplore,
    onExitExplore: exitExplore,
    onReveal() {
      review?.session.reveal();
      render();
    },
    onGrade: gradeCard,
    onScope(scope) {
      if (review && review.scope !== scope) startReview(scope, review.origin);
      else if (reviewDone && reviewDone.scope !== scope) startReview(scope, reviewDone.origin);
    },
    onExitReview: exitReview,
  });

  refreshDue();

  return {
    panel,
    get isOpen() {
      return focus >= 0;
    },
    get focus() {
      return focus;
    },
    open,
    close,
    dismiss() {
      if (focus >= 0 && !tour && !review && !reviewDone) close();
    },
    handleKey(event) {
      if (focus < 0) return false;
      if (event.key === 'Escape') {
        // Esc leaves a review for the topic it started from; anywhere else it returns to the galaxy.
        if (review || reviewDone) exitReview();
        else close();
        return true;
      }
      const target = event.target;
      const typing = target instanceof HTMLElement && target.closest('input, textarea, select') !== null;
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return false;
      if (tour && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
        stepExplore(event.key === 'ArrowRight' ? 1 : -1);
        return true;
      }
      if (review?.session.revealed && (event.key === '1' || event.key === '2' || event.key === '3')) {
        gradeCard(event.key === '1' ? 'again' : event.key === '2' ? 'good' : 'easy');
        return true;
      }
      return false;
    },
    setVisible(mask) {
      visible = mask;
      if (focus < 0) return;
      // The timeline can take away the node in focus, or a stop on the tour.
      const gone = !mask[focus] || (review !== null && !mask[review.origin]) || (reviewDone !== null && !mask[reviewDone.origin]);
      if (gone) {
        close();
        return;
      }
      if (tour && tour.path.some((node) => !mask[node])) tour = null;
      renderer.setFocus(focus, tour ? [...visibleNeighbours(focus), ...tour.path] : visibleNeighbours(focus));
      render();
    },
    refreshDue,
    state() {
      const card = review?.session.current;
      return {
        open: focus >= 0,
        view: focus < 0 ? 'none' : reviewDone ? 'reviewDone' : review ? 'review' : tour ? 'explore' : 'detail',
        focus: focus < 0 ? null : data.nodes[focus]?.id,
        neighbours: focus < 0 ? [] : visibleNeighbours(focus).map((node) => data.nodes[node]?.id),
        tour: tour ? { step: tour.step, path: tour.path.map((node) => data.nodes[node]?.id) } : null,
        review: review
          ? { scope: review.scope, revealed: review.session.revealed, ...review.session.progress, node: card ? data.nodes[card.node]?.id : null }
          : null,
        due: data.nodes.filter((_, index) => due[index]).map((node) => node.id),
      };
    },
  };
}
