import type { Cluster } from '../data/types';
import { el } from './dom';

export interface LegendHandlers {
  onCluster(index: number): void;
  onOverview(): void;
  /** The collapsed panel (small screens) was opened. */
  onOpen(): void;
}

export interface Legend {
  element: HTMLElement;
  /** Highlight one cluster (-1 for none). */
  setActive(index: number): void;
  /** Update how many nodes of each cluster are currently on screen. */
  setCounts(visible: readonly number[]): void;
  /** Show how many nodes of each cluster are due for review. */
  setDue(due: readonly number[]): void;
  /** Collapse the panel (small screens). */
  close(): void;
  /** True while the collapsible panel is open (small screens). */
  readonly isOpen: boolean;
}

export function createLegend(clusters: readonly Cluster[], totals: readonly number[], handlers: LegendHandlers): Legend {
  const element = el('nav', 'legend', undefined, { 'aria-label': 'Clusters' });

  const toggle = el('button', 'glass legend-toggle', undefined, {
    type: 'button',
    'aria-expanded': 'false',
    'aria-controls': 'legend-panel',
  });
  const toggleDue = el('span', 'legend-due legend-toggle-due');
  toggle.append(el('span', 'legend-toggle-dots'), el('span', undefined, 'Clusters'), toggleDue);

  const panel = el('div', 'glass legend-panel', undefined, { id: 'legend-panel' });

  const groups: string[] = [];
  for (const cluster of clusters) if (!groups.includes(cluster.group)) groups.push(cluster.group);

  const rows: HTMLButtonElement[] = [];
  const counts: HTMLElement[] = [];
  const dueBadges: HTMLElement[] = [];
  for (const group of groups) {
    const section = el('div', 'legend-group');
    if (group !== '') section.append(el('h2', 'legend-heading', group));
    const list = el('ul', 'legend-list');
    clusters.forEach((cluster, index) => {
      if (cluster.group !== group) return;
      const row = el('button', 'legend-row', undefined, { type: 'button', title: `Fly to ${cluster.name}` });
      const dot = el('span', 'legend-dot');
      dot.style.setProperty('--dot', cluster.color);
      const count = el('span', 'legend-count', String(totals[index] ?? 0));
      const dueBadge = el('span', 'legend-due');
      row.append(dot, el('span', 'legend-name', cluster.name), dueBadge, count);
      dueBadges[index] = dueBadge;
      row.addEventListener('click', () => handlers.onCluster(index));
      rows[index] = row;
      counts[index] = count;
      const item = el('li');
      item.append(row);
      list.append(item);
    });
    section.append(list);
    panel.append(section);
  }

  const overview = el('button', 'legend-overview', 'Show whole galaxy', { type: 'button' });
  overview.addEventListener('click', () => handlers.onOverview());
  panel.append(overview);

  const setOpen = (open: boolean): void => {
    element.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
  };
  toggle.addEventListener('click', () => {
    const open = !element.classList.contains('is-open');
    setOpen(open);
    if (open) handlers.onOpen();
  });

  element.append(toggle, panel);

  return {
    element,
    setActive(index) {
      rows.forEach((row, i) => row.classList.toggle('is-active', i === index));
      overview.classList.toggle('is-visible', index >= 0);
    },
    setCounts(visible) {
      rows.forEach((row, i) => {
        const shown = visible[i] ?? 0;
        row.classList.toggle('is-empty', shown === 0);
        const count = counts[i];
        if (count) count.textContent = String(shown);
      });
    },
    setDue(due) {
      let total = 0;
      dueBadges.forEach((badge, i) => {
        const count = due[i] ?? 0;
        total += count;
        badge.textContent = count > 0 ? `${count} due` : '';
        badge.classList.toggle('is-visible', count > 0);
        if (count > 0) badge.setAttribute('aria-label', `${count} due for review`);
        else badge.removeAttribute('aria-label');
      });
      toggleDue.textContent = total > 0 ? `${total} due` : '';
      toggleDue.classList.toggle('is-visible', total > 0);
    },
    close() {
      setOpen(false);
    },
    get isOpen() {
      return element.classList.contains('is-open');
    },
  };
}
