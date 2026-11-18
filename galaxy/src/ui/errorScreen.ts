import type { ValidationIssue } from '../data/types';
import { el } from './dom';

const MAX_SHOWN = 6;

/** Replace the contents of `root` with a readable error card. Used instead of ever showing a blank page. */
export function renderError(root: HTMLElement, title: string, issues: ValidationIssue[], hint?: string): void {
  const screen = el('div', 'error-screen');
  const card = el('section', 'glass error-card', undefined, { role: 'alert' });
  card.append(el('p', 'error-eyebrow', 'Galaxy'), el('h1', 'error-title', title));

  const list = el('ul', 'error-list');
  for (const issue of issues.slice(0, MAX_SHOWN)) {
    const item = el('li', 'error-item');
    const where = el('div', 'error-where');
    if (issue.line !== undefined) {
      const position = issue.column !== undefined ? `Line ${issue.line}, column ${issue.column}` : `Line ${issue.line}`;
      where.append(el('span', 'error-line', position));
    }
    if (issue.path !== '') where.append(el('code', 'error-path', issue.path));
    if (where.childElementCount > 0) item.append(where);
    item.append(el('p', 'error-message', issue.message));
    list.append(item);
  }
  card.append(list);

  if (issues.length > MAX_SHOWN) {
    const more = issues.length - MAX_SHOWN;
    card.append(el('p', 'error-more', `…and ${more} more ${more === 1 ? 'problem' : 'problems'}. Fix these first, then reload.`));
  }
  card.append(el('p', 'error-hint', hint ?? 'Fix public/galaxy.json, save it, and reload this page.'));

  screen.append(card);
  root.replaceChildren(screen);
}
