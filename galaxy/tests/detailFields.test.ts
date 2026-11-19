import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateGalaxy, validateGalaxyText } from '../src/data/validate';
import type { ValidationIssue } from '../src/data/types';

const base = { id: 'limits', label: 'Limits', cluster: 'calc', date: '2026-08-19' };
const file = (node: Record<string, unknown>) => ({
  clusters: [{ id: 'calc', name: 'Calculus', color: '#4d8dff' }],
  nodes: [{ ...base, ...node }],
  links: [],
});

function issuesOf(node: Record<string, unknown>): ValidationIssue[] {
  const result = validateGalaxy(file(node));
  if (result.ok) throw new Error('expected validation to fail');
  return result.issues;
}

function nodeOf(node: Record<string, unknown>) {
  const result = validateGalaxy(file(node));
  if (!result.ok) throw new Error(`expected a valid file: ${JSON.stringify(result.issues)}`);
  return result.data.nodes[0]!;
}

describe('optional detail fields', () => {
  it('accepts a node with overview, points and cards', () => {
    const node = nodeOf({
      overview: 'What a function approaches.',
      points: ['One-sided limits', 'Limits at infinity'],
      cards: [{ q: 'What is a limit?', a: 'The value a function approaches.' }],
    });
    expect(node.overview).toBe('What a function approaches.');
    expect(node.points).toEqual(['One-sided limits', 'Limits at infinity']);
    expect(node.cards).toEqual([{ q: 'What is a limit?', a: 'The value a function approaches.' }]);
  });

  it('keeps all three optional: a bare node is still valid and carries none of them', () => {
    const node = nodeOf({});
    expect(node).toEqual(base);
    expect('cards' in node).toBe(false);
  });

  it('treats empty lists as "none"', () => {
    const node = nodeOf({ points: [], cards: [] });
    expect(node.points).toBeUndefined();
    expect(node.cards).toBeUndefined();
  });
});

describe('overview', () => {
  it.each([
    [42, /Must be text/],
    [['a'], /Must be text/],
    [null, /Must be text/],
    ['   ', /Can't be empty/],
  ])('rejects %j', (overview, pattern) => {
    const [issue, ...rest] = issuesOf({ overview });
    expect(rest).toEqual([]);
    expect(issue?.path).toBe('nodes[0].overview');
    expect(issue?.message).toMatch(pattern);
  });
});

describe('points', () => {
  it('rejects anything that is not a list', () => {
    const [issue] = issuesOf({ points: 'one point' });
    expect(issue?.path).toBe('nodes[0].points');
    expect(issue?.message).toMatch(/Must be a list of texts/);
  });

  it('points at the exact bad item', () => {
    const issues = issuesOf({ points: ['fine', 7, '', { text: 'x' }] });
    expect(issues.map((issue) => issue.path)).toEqual(['nodes[0].points[1]', 'nodes[0].points[2]', 'nodes[0].points[3]']);
    expect(issues[1]?.message).toMatch(/Can't be empty/);
  });
});

describe('cards', () => {
  it('rejects anything that is not a list', () => {
    const [issue] = issuesOf({ cards: { q: 'Q', a: 'A' } });
    expect(issue?.path).toBe('nodes[0].cards');
    expect(issue?.message).toMatch(/Must be a list of cards/);
  });

  it('rejects a card that is not an object', () => {
    const [issue] = issuesOf({ cards: ['What is a limit?'] });
    expect(issue?.path).toBe('nodes[0].cards[0]');
  });

  it('requires both q and a', () => {
    const issues = issuesOf({ cards: [{ q: 'Only a question' }, { a: 'Only an answer' }, {}] });
    expect(issues.map((issue) => issue.path)).toEqual([
      'nodes[0].cards[0].a',
      'nodes[0].cards[1].q',
      'nodes[0].cards[2].q',
      'nodes[0].cards[2].a',
    ]);
    expect(issues[0]?.message).toMatch(/Missing/);
  });

  it('rejects empty or non-text q and a', () => {
    const issues = issuesOf({ cards: [{ q: '', a: 'A' }, { q: 'Q', a: 12 }] });
    expect(issues.map((issue) => issue.path)).toEqual(['nodes[0].cards[0].q', 'nodes[0].cards[1].a']);
  });

  it('stays strict about unknown fields inside a card', () => {
    const issues = issuesOf({ cards: [{ q: 'Q', a: 'A', hint: 'H' }, { Q: 'Q', a: 'A' }] });
    expect(issues[0]).toMatchObject({ path: 'nodes[0].cards[0].hint', message: expect.stringContaining('Allowed: q, a') });
    expect(issues[1]).toMatchObject({ path: 'nodes[0].cards[1].Q', message: expect.stringContaining('Did you mean "q"?') });
    expect(issues[2]?.path).toBe('nodes[0].cards[1].q');
  });

  it('still flags misspelled node fields next to the new ones', () => {
    const issues = issuesOf({ overveiw: 'typo', card: [] });
    expect(issues.map((issue) => issue.message)).toEqual([
      expect.stringContaining('Did you mean "overview"?'),
      expect.stringContaining('Did you mean "cards"?'),
    ]);
  });
});

describe('line numbers for the new fields', () => {
  const text = `{
  "clusters": [{ "id": "calc", "name": "Calculus", "color": "#4d8dff" }],
  "nodes": [
    {
      "id": "limits", "label": "Limits", "cluster": "calc", "date": "2026-08-19",
      "overview": "What a function approaches.",
      "points": [
        "One-sided limits",
        17
      ],
      "cards": [
        { "q": "What is a limit?", "a": "The value a function approaches." },
        { "q": "When does a limit not exist?" }
      ]
    }
  ]
}`;

  it('reports the line of a bad point and of a card with a missing answer', () => {
    const result = validateGalaxyText(text);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toEqual([
      { path: 'nodes[0].points[1]', message: expect.stringContaining('Must be text'), line: 9 },
      { path: 'nodes[0].cards[1].a', message: expect.stringContaining('Missing'), line: 13 },
    ]);
  });
});

describe('seed galaxy.json content', () => {
  const text = readFileSync(fileURLToPath(new URL('../public/galaxy.json', import.meta.url)), 'utf8');
  const result = validateGalaxyText(text);
  if (!result.ok) throw new Error('seed is invalid');
  const { nodes } = result.data;

  it('gives every node an overview and key points', () => {
    for (const node of nodes) {
      expect(node.overview?.length ?? 0, node.id).toBeGreaterThan(40);
      expect(node.points?.length ?? 0, node.id).toBeGreaterThanOrEqual(2);
    }
  });

  it('gives most nodes flashcards, and leaves a few without (so the Review button is optional)', () => {
    const withCards = nodes.filter((node) => (node.cards?.length ?? 0) > 0);
    expect(withCards.length).toBeGreaterThan(nodes.length * 0.85);
    expect(withCards.length).toBeLessThan(nodes.length);
    for (const node of withCards) {
      for (const card of node.cards ?? []) {
        expect(card.q.trim().length, node.id).toBeGreaterThan(8);
        expect(card.a.trim().length, node.id).toBeGreaterThan(1);
      }
    }
  });
});
