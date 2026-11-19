import { groupByCluster } from '../data/graph';
import { dateLabel, dayNumber } from '../data/timeline';
import type { GalaxyData } from '../data/types';
import { explorePath } from '../explore/path';
import type { GalaxyRenderer } from '../render/renderer';
import { formatSpan, isDue, schedule, statusOf, worseGrade, type Grade } from '../review/scheduler';
import { ReviewSession } from '../review/session';
import { STORAGE_KEY, loadStore, mergeStores, parseStore, saveStore, type ReviewStore, type StorageLike } from '../review/store';
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
  /** Where review progress is kept. Defaults to the browser's localStorage; injectable for tests. */
  storage?: StorageLike | null;
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
  let reviewDone: {
    scope: ReviewScope;
    origin: number;
    lines: Array<{ label: string; next: string }>;
    more: number;
    saved: boolean;
  } | null = null;
  /** What the panel last showed that depends on the timeline, so an unchanged day doesn't rebuild it. */
  let shown = '';

  const loadSaved = (): ReviewStore => (options.storage === undefined ? loadStore() : loadStore(options.storage));
  const store: ReviewStore = loadSaved();
  /** False once the browser has refused to store progress. */
  let saved = true;
  let due: boolean[] = data.nodes.map(() => false);

  const cardsOf = (node: number): number => data.nodes[node]?.cards?.length ?? 0;
  const visibleNeighbours = (node: number): number[] => (neighbours[node] ?? []).filter((other) => visible[other]);
  const routeFrom = (node: number): number[] => explorePath(node, neighbours, { allowed: visible, rank: days });

  const refreshDue = (): void => {
    const time = now();
    const next = data.nodes.map((node, index) => cardsOf(index) > 0 && isDue(store[node.id], time));
    const changed = next.some((value, index) => value !== due[index]);
    due = next;
    if (!changed) return;
    options.onDueChange(due);
    // The open panel shows "Next review in ..." / "Due for review": keep it in step with the rings.
    if (focus >= 0 && !review && !reviewDone) render(false);
  };

  /** Record a node's new schedule, keeping whatever another tab has saved in the meantime. */
  const persist = (id: string, state: ReviewStore[string]): void => {
    store[id] = state;
    Object.assign(store, mergeStores(loadSaved(), store));
    saved = options.storage === undefined ? saveStore(store) : saveStore(store, options.storage);
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
      linked: groupByCluster(visibleNeighbours(node), nodeCluster, nodeCluster[node]).map((group) => ({
        cluster: data.clusters[group.cluster]?.name ?? '',
        color: data.clusters[group.cluster]?.color ?? '#ffffff',
        items: group.nodes.map((other) => ({ index: other, label: data.nodes[other]?.label ?? '' })),
      })),
      cardCount: cards,
      reviewStatus,
      reviewDue: status === 'due' && cards > 0,
      // A route needs at least one linked node that is on screen.
      canExplore: visibleNeighbours(node).length > 0,
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
      return {
        kind: 'reviewDone',
        node: viewOf(reviewDone.origin),
        scope: reviewDone.scope,
        lines: reviewDone.lines,
        more: reviewDone.more,
        saved: reviewDone.saved,
      };
    }
    if (review) {
      const card = review.session.current;
      if (!card) return null;
      const item = data.nodes[card.node]!;
      const content = item.cards?.[card.card];
      const time = now();
      // A node is graded by its weakest card, so an earlier "Again" on this node caps what this card can do.
      // A card that is back after "Again" changes nothing, and says so instead of promising a date.
      const repeat = review.session.currentIsRepeat;
      const weakest = review.session.pendingGrade(card.node);
      const hint = (grade: Grade): string => {
        if (repeat) return grade === 'again' ? 'once more' : 'got it';
        const effective = weakest === undefined ? grade : worseGrade(weakest, grade);
        return formatSpan(schedule(store[item.id], effective, time).due - time);
      };
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
        repeat,
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
        nextIndex: next ?? -1,
      };
    }
    return { kind: 'detail', node: viewOf(focus) };
  };

  /** Redraw the panel. `takeFocus` is false for updates the user didn't trigger (timeline, due timer). */
  const render = (takeFocus = true): void => {
    const view = currentView();
    if (view) panel.show(view, takeFocus);
    shown = '';
  };

  /** Everything in the panel that changes when the timeline moves. */
  const timelineSignature = (): string =>
    [
      visibleNeighbours(focus).join(','),
      tour ? tour.path.join(',') : '',
      review ? countCards(reviewItems(review.origin, 'cluster')) : '',
    ].join('|');

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
      persist(id, schedule(store[id], result.grade, now()));
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
        saved,
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
    onJump(node) {
      // On a tour, the next (or previous) stop in the list is the same as pressing Next (or Back).
      if (tour && node === tour.path[tour.step + 1]) stepExplore(1);
      else if (tour && node === tour.path[tour.step - 1]) stepExplore(-1);
      else open(node);
    },
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

  // Another tab reviewed something: take its progress on board straight away.
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (event) => {
      if (event.key !== STORAGE_KEY || event.newValue === null) return;
      Object.assign(store, mergeStores(store, parseStore(event.newValue)));
      refreshDue();
    });
  }

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
      // A review can't go on to cards whose node is no longer on screen: go back to the skill it started from.
      if (review && review.session.remainingNodes().some((node) => !mask[node])) {
        exitReview();
        return;
      }
      if (tour && tour.path.some((node) => !mask[node])) tour = null;
      // Most days change nothing the panel shows. Leave it (and the keyboard focus) alone then.
      const signature = timelineSignature();
      if (signature === shown) return;
      renderer.setFocus(focus, tour ? [...visibleNeighbours(focus), ...tour.path] : visibleNeighbours(focus));
      render(false);
      shown = signature;
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
