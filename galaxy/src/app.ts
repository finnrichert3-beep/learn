import { computeSizes } from './data/sizing';
import { countVisible, dateLabel, dayAt, dayNumber, monthLabel, monthTicks, timelineRange, visibleMask } from './data/timeline';
import type { GalaxyData } from './data/types';
import { computeLayout } from './layout/layout';
import { GalaxyRenderer, type Insets } from './render/renderer';
import { createDebugPanel } from './ui/debugPanel';
import { el } from './ui/dom';
import { createLegend } from './ui/legend';
import { createTimelineBar } from './ui/timelineBar';
import { createTooltip } from './ui/tooltip';

/** Seconds a full playback takes, start to finish. */
const PLAYBACK_SECONDS = 18;
/** A press that moves less than this (px) and is shorter than TAP_MS counts as a tap, not a drag. */
const TAP_DISTANCE = 7;
const TAP_MS = 500;

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

  // ---- renderer (throws without WebGL, before the page is touched) ------------
  const canvas = el('canvas', 'scene', undefined, {
    'aria-label': `3D galaxy of ${data.nodes.length} topics in ${data.clusters.length} clusters. Use the cluster list and the timeline to explore.`,
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
    renderer.flyHome();
  };
  const legend = createLegend(data.clusters, clusterTotals, {
    onCluster(index) {
      if (index === activeCluster) {
        showOverview();
        return;
      }
      activeCluster = index;
      legend.setActive(index);
      legend.close();
      renderer.flyToCluster(index);
    },
    onOverview: showOverview,
    onOpen() {
      // The open panel covers the scene, so drop any pinned label underneath it.
      selected = -1;
      hovered = -1;
      syncActiveNode();
    },
  });
  brand.addEventListener('click', showOverview);

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
      const mask = visibleMask(days, day);
      shownCount = countVisible(days, day);
      renderer.setVisible(mask, immediate);
      const perCluster = data.clusters.map(() => 0);
      mask.forEach((visible, node) => {
        if (visible) perCluster[nodeCluster[node] ?? 0]! += 1;
      });
      legend.setCounts(perCluster);
      if (selected >= 0 && !mask[selected]) selected = -1;
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

  // ---- hover / tap labels ------------------------------------------------------
  const tooltip = createTooltip();
  let hovered = -1;
  let selected = -1;
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
    const next = hovered >= 0 ? hovered : selected;
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
    press = { x: event.clientX, y: event.clientY, time: performance.now() };
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
    // Tap a node to pin its label; tap empty space (or the same node) to clear it.
    const hit = renderer.pick(x, y, event.pointerType !== 'mouse');
    selected = hit === selected ? -1 : hit;
    if (event.pointerType !== 'mouse') hovered = -1;
    syncActiveNode();
  });
  canvas.addEventListener('pointercancel', () => {
    press = null;
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      selected = -1;
      legend.close();
      syncActiveNode();
      return;
    }
    const target = event.target;
    const onControl = target instanceof HTMLElement && target.closest('button, input, a') !== null;
    if (event.key === ' ' && !onControl) {
      event.preventDefault();
      timeline.element.querySelector<HTMLButtonElement>('.timeline-play')?.click();
    }
  });

  // ---- debug readout (?debug) ---------------------------------------------------
  const debugPanel = debug ? createDebugPanel() : null;

  ui.append(brand, legend.element, timeline.element, tooltip.element);
  if (debugPanel) ui.append(debugPanel.element);
  root.replaceChildren(canvas, ui);

  // ---- sizing ------------------------------------------------------------------
  const measure = (): void => {
    const width = root.clientWidth;
    const height = root.clientHeight;
    const bar = timeline.element.getBoundingClientRect();
    const head = brand.getBoundingClientRect();
    const panel = legend.element.querySelector('.legend-panel')?.getBoundingClientRect();
    const docked = window.matchMedia('(min-width: 861px) and (min-height: 521px)').matches;
    const insets: Insets = {
      top: docked ? 16 : head.bottom + 4,
      right: 12,
      bottom: Math.max(0, height - bar.top) + 10,
      left: docked && panel ? panel.right + 4 : 12,
    };
    renderer.resize(width, height, insets);
    placeTooltip();
  };
  new ResizeObserver(measure).observe(root);
  measure();

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
    };
  }
}
