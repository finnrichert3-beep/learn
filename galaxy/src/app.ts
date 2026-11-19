import { buildNeighbours } from './data/graph';
import { computeSizes } from './data/sizing';
import { countVisible, dateLabel, dayAt, dayNumber, monthLabel, monthTicks, timelineRange, visibleMask } from './data/timeline';
import type { GalaxyData } from './data/types';
import { createDetailMode } from './detail/detailMode';
import { computeLayout } from './layout/layout';
import { GalaxyRenderer, type Insets } from './render/renderer';
import { createDebugPanel } from './ui/debugPanel';
import { el } from './ui/dom';
import { createLegend } from './ui/legend';
import { createTimelineBar } from './ui/timelineBar';
import { createTooltip } from './ui/tooltip';

/** Seconds a full playback takes, start to finish. */
const PLAYBACK_SECONDS = 18;
/** How often to re-check which nodes have become due for review while the page stays open. */
const DUE_CHECK_MS = 30_000;
/** A press that moves less than this (px) and is shorter than TAP_MS counts as a tap, not a drag. */
const TAP_DISTANCE = 7;
const TAP_MS = 500;
/** Below this width the detail panel is a bottom sheet instead of a side panel (matches style.css). */
const SHEET_QUERY = '(max-width: 700px)';
/** Between these widths the docked legend hides while the detail panel is open (matches style.css). */
const LEGEND_YIELDS_QUERY = '(min-width: 861px) and (max-width: 1180px)';

/** Build the page and start rendering. Throws if WebGL is unavailable (boot turns that into an error card). */
export function startApp(root: HTMLElement, data: GalaxyData): void {
  const params = new URLSearchParams(window.location.search);
  const debug = params.has('debug');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const mobile = window.matchMedia('(pointer: coarse)').matches || Math.min(window.innerWidth, window.innerHeight) < 600;

  // ---- data -> layout (settled before anything is drawn) ----------------------
  const sizes = computeSizes(data);
  const layout = computeLayout(data);
  const days = data.nodes.map((node) => dayNumber(node.date));
  const range = timelineRange(days);
  const span = range.end - range.start;
  const clusterIndex = new Map(data.clusters.map((cluster, index) => [cluster.id, index]));
  const nodeCluster = data.nodes.map((node) => clusterIndex.get(node.cluster) ?? 0);
  const clusterTotals = data.clusters.map((_, index) => nodeCluster.filter((cluster) => cluster === index).length);
  const neighbours = buildNeighbours(data);

  // ---- renderer (throws without WebGL, before the page is touched) ------------
  const canvas = el('canvas', 'scene', undefined, {
    'aria-label': `3D galaxy of ${data.nodes.length} topics in ${data.clusters.length} clusters. Click a topic to open its details, or use the cluster list and the timeline.`,
    role: 'img',
  });
  const renderer = new GalaxyRenderer(canvas, data, layout, sizes, {
    reducedMotion,
    mobile,
    lockQuality: params.has('lockquality'),
  });

  // ---- page ------------------------------------------------------------------
  const ui = el('div', 'ui');
  const groupNames = layout.groups.map((group) => group.name).filter((name) => name !== '');
  const brand = el('button', 'brand', undefined, { type: 'button', title: 'Show whole galaxy' });
  brand.append(el('span', 'brand-name', 'Galaxy'));
  if (groupNames.length > 0) brand.append(el('span', 'brand-sub', groupNames.join(' × ')));

  let activeCluster = -1;
  const showOverview = (): void => {
    activeCluster = -1;
    legend.setActive(-1);
    legend.close();
    detail.close(false);
    renderer.flyHome();
  };
  const legend = createLegend(data.clusters, clusterTotals, {
    onCluster(index) {
      if (index === activeCluster) {
        showOverview();
        return;
      }
      detail.close(false);
      activeCluster = index;
      legend.setActive(index);
      legend.close();
      renderer.flyToCluster(index);
    },
    onOverview: showOverview,
    onOpen() {
      // The open panel covers the scene, so drop any label underneath it.
      hovered = -1;
      syncActiveNode();
    },
  });
  brand.addEventListener('click', showOverview);

  // ---- node detail mode: focus, explore, review ---------------------------------
  let mask: boolean[] = data.nodes.map(() => false);
  let dueMask: readonly boolean[] = data.nodes.map(() => false);
  const showDueCounts = (): void => {
    // Only nodes that are on screen count, so the legend matches the rings you can see.
    const perCluster = data.clusters.map(() => 0);
    dueMask.forEach((isDue, node) => {
      if (isDue && mask[node]) perCluster[nodeCluster[node] ?? 0]! += 1;
    });
    legend.setDue(perCluster);
  };

  const detail = createDetailMode({
    data,
    days,
    neighbours,
    nodeCluster,
    renderer,
    onOpenChange(open) {
      ui.classList.toggle('has-detail', open);
      if (open) {
        // Reading about one node: stop the timeline and let go of any cluster highlight.
        playing = false;
        activeCluster = -1;
        legend.setActive(-1);
        legend.close();
        hovered = -1;
        syncActiveNode();
        refresh();
      }
      renderer.setViewInsets(currentInsets().view);
    },
    onDueChange(due) {
      dueMask = due;
      renderer.setDue(due);
      showDueCounts();
    },
  });

  // ---- timeline: one function decides what is visible, for the scene and the UI alike
  let position = reducedMotion || span === 0 ? range.end : range.start;
  let playing = !reducedMotion && span > 0;
  let shownDay = Number.NaN;
  let shownCount = 0;

  const timeline = createTimelineBar(span, monthTicks(range), {
    onToggle() {
      if (!playing && position >= range.end) position = range.start;
      playing = !playing && span > 0;
      refresh();
    },
    onScrub(dayOffset) {
      playing = false;
      position = range.start + dayOffset;
      refresh();
    },
  });

  const refresh = (immediate = false): void => {
    const day = dayAt(range, position);
    if (day !== shownDay) {
      shownDay = day;
      mask = visibleMask(days, day);
      shownCount = countVisible(days, day);
      renderer.setVisible(mask, immediate);
      const perCluster = data.clusters.map(() => 0);
      mask.forEach((visible, node) => {
        if (visible) perCluster[nodeCluster[node] ?? 0]! += 1;
      });
      legend.setCounts(perCluster);
      showDueCounts();
      detail.setVisible(mask);
      if (hovered >= 0 && !mask[hovered]) hovered = -1;
      syncActiveNode();
    }
    timeline.set({
      dayOffset: day - range.start,
      month: monthLabel(day),
      fullDate: dateLabel(day),
      count: shownCount,
      total: data.nodes.length,
      playing,
      atEnd: position >= range.end,
    });
  };

  // ---- hover labels, click to open ------------------------------------------------
  const tooltip = createTooltip();
  let hovered = -1;
  let activeNode = -1;

  const placeTooltip = (): void => {
    if (activeNode < 0) return;
    const point = renderer.screenPoint(activeNode);
    if (!point.inView) {
      tooltip.hide();
      return;
    }
    tooltip.element.classList.add('is-visible');
    tooltip.place(point.x, point.y, Math.max(12, point.radius + 8), canvas.clientWidth, canvas.clientHeight);
  };

  const syncActiveNode = (): void => {
    // The node in focus already has its name in the panel, so it gets no hover label.
    const next = hovered === detail.focus ? -1 : hovered;
    canvas.classList.toggle('is-pointing', hovered >= 0);
    if (next === activeNode) return;
    activeNode = next;
    renderer.setHover(next);
    const node = data.nodes[next];
    if (!node) {
      tooltip.hide();
      return;
    }
    const cluster = data.clusters[nodeCluster[next] ?? 0];
    tooltip.show({
      label: node.label,
      cluster: cluster?.name ?? '',
      color: cluster?.color ?? '#ffffff',
      date: dateLabel(dayNumber(node.date)),
    });
    placeTooltip();
  };

  const localPoint = (event: PointerEvent): [number, number] => {
    const bounds = canvas.getBoundingClientRect();
    return [event.clientX - bounds.left, event.clientY - bounds.top];
  };

  let press: { x: number; y: number; time: number } | null = null;
  canvas.addEventListener('pointerdown', (event) => {
    // Only the main button (or a touch) can open a node; right-drag pans and must not count as a click.
    press = event.button === 0 ? { x: event.clientX, y: event.clientY, time: performance.now() } : null;
    legend.close();
  });
  canvas.addEventListener('pointermove', (event) => {
    if (event.pointerType !== 'mouse' || event.buttons !== 0) return;
    const [x, y] = localPoint(event);
    hovered = renderer.pick(x, y, false);
    syncActiveNode();
  });
  canvas.addEventListener('pointerleave', () => {
    hovered = -1;
    syncActiveNode();
  });
  canvas.addEventListener('pointerup', (event) => {
    const start = press;
    press = null;
    if (!start) return;
    const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
    if (moved > TAP_DISTANCE || performance.now() - start.time > TAP_MS) return;
    const [x, y] = localPoint(event);
    // Click or tap a node to open it; click empty space to go back to the galaxy.
    const hit = renderer.pick(x, y, event.pointerType !== 'mouse');
    if (event.pointerType !== 'mouse') hovered = -1;
    if (hit >= 0) detail.open(hit);
    else detail.dismiss();
    syncActiveNode();
  });
  canvas.addEventListener('pointercancel', () => {
    press = null;
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && legend.isOpen) {
      legend.close();
      return;
    }
    // Detail mode gets the first go: Esc, arrow keys on a tour, 1-3 on a review card.
    if (detail.handleKey(event)) {
      event.preventDefault();
      syncActiveNode();
      return;
    }
    const target = event.target;
    const onControl = target instanceof HTMLElement && target.closest('button, input, a') !== null;
    if (event.key === ' ' && !onControl && !detail.isOpen) {
      event.preventDefault();
      timeline.element.querySelector<HTMLButtonElement>('.timeline-play')?.click();
    }
  });

  // ---- debug readout (?debug) ---------------------------------------------------
  const debugPanel = debug ? createDebugPanel() : null;

  ui.append(brand, legend.element, timeline.element, detail.panel.element, tooltip.element);
  if (debugPanel) ui.append(debugPanel.element);
  root.replaceChildren(canvas, ui);

  // ---- sizing ------------------------------------------------------------------
  /**
   * How much of the screen the UI covers: `base` for the permanent parts (the overview is
   * framed inside it), `view` with the detail panel added while it is open.
   */
  function currentInsets(): { base: Insets; view: Insets } {
    const width = root.clientWidth;
    const height = root.clientHeight;
    const bar = timeline.element.getBoundingClientRect();
    const head = brand.getBoundingClientRect();
    const panel = legend.element.querySelector('.legend-panel')?.getBoundingClientRect();
    const docked = window.matchMedia('(min-width: 861px) and (min-height: 521px)').matches;
    const base: Insets = {
      top: docked ? 16 : head.bottom + 4,
      right: 12,
      bottom: Math.max(0, height - bar.top) + 10,
      left: docked && panel ? panel.right + 4 : 12,
    };
    if (!detail.isOpen) return { base, view: base };

    // offsetLeft / offsetHeight ignore the slide-in transform, so they are right even mid-animation.
    const sheet = window.matchMedia(SHEET_QUERY).matches;
    const side = detail.panel.element;
    // On mid-width screens the legend hides while a node is open (see style.css), which frees the left side.
    const left = window.matchMedia(LEGEND_YIELDS_QUERY).matches ? 12 : base.left;
    const view: Insets = sheet
      ? { top: base.top, right: 12, bottom: side.offsetHeight + 12, left: 12 }
      : { ...base, left, right: Math.max(12, width - side.offsetLeft + 8) };
    return { base, view };
  }

  const measure = (): void => {
    const { base, view } = currentInsets();
    renderer.resize(root.clientWidth, root.clientHeight, base, view);
    placeTooltip();
  };
  new ResizeObserver(measure).observe(root);
  measure();
  // The bottom sheet changes height between notes and review cards; keep the galaxy centred above it.
  new ResizeObserver(() => {
    if (detail.isOpen) renderer.setViewInsets(currentInsets().view);
  }).observe(detail.panel.element);

  // ---- frame hooks ---------------------------------------------------------------
  let debugClock = 0;
  renderer.onFrame = (delta) => {
    if (playing) {
      position += (span / PLAYBACK_SECONDS) * delta;
      if (position >= range.end) {
        position = range.end;
        playing = false;
      }
      refresh();
    }
    if (debugPanel) {
      debugClock += delta;
      if (debugClock >= 0.25) {
        debugClock = 0;
        debugPanel.set(renderer.stats());
      }
    }
  };
  renderer.onAfterRender = placeTooltip;
  renderer.onInteract = () => {
    hovered = -1;
    syncActiveNode();
  };

  refresh(true);
  renderer.start();

  // Reviews become due as time passes, also while the page just sits open.
  window.setInterval(() => detail.refreshDue(), DUE_CHECK_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) detail.refreshDue();
  });

  if (debug) {
    // Read-only hooks for checking that the UI and the scene agree.
    (window as unknown as { __galaxy: unknown }).__galaxy = {
      state: () => ({
        ...renderer.stats(),
        running: renderer.isRunning,
        playing,
        day: dateLabel(shownDay),
        month: monthLabel(shownDay),
        count: shownCount,
        expectedCount: countVisible(days, shownDay),
        total: data.nodes.length,
        reducedMotion,
        mobile,
      }),
      screenPoint: (index: number) => renderer.screenPoint(index),
      nodes: data.nodes.map((node) => ({ id: node.id, date: node.date })),
      detail: () => detail.state(),
    };
  }
}
