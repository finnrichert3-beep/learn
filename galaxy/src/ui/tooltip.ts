import { el } from './dom';

export interface TooltipContent {
  label: string;
  cluster: string;
  color: string;
  date: string;
}

export interface Tooltip {
  element: HTMLElement;
  show(content: TooltipContent): void;
  /** Place the tooltip next to a point (CSS pixels inside `bounds`). */
  place(x: number, y: number, offset: number, boundsWidth: number, boundsHeight: number): void;
  hide(): void;
}

export function createTooltip(): Tooltip {
  const element = el('div', 'glass tooltip', undefined, { role: 'status' });
  const label = el('div', 'tooltip-label');
  const meta = el('div', 'tooltip-meta');
  const dot = el('span', 'tooltip-dot');
  const cluster = el('span', 'tooltip-cluster');
  const date = el('span', 'tooltip-date');
  meta.append(dot, cluster, date);
  element.append(label, meta);

  return {
    element,
    show(content) {
      label.textContent = content.label;
      cluster.textContent = content.cluster;
      date.textContent = content.date;
      dot.style.setProperty('--dot', content.color);
      element.classList.add('is-visible');
    },
    place(x, y, offset, boundsWidth, boundsHeight) {
      const width = element.offsetWidth;
      const height = element.offsetHeight;
      const margin = 10;
      const left = Math.min(boundsWidth - width - margin, Math.max(margin, x - width / 2));
      // Prefer above the node; flip below when there is no room.
      let top = y - offset - height;
      if (top < margin) top = Math.min(boundsHeight - height - margin, y + offset);
      element.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
    },
    hide() {
      element.classList.remove('is-visible');
    },
  };
}
