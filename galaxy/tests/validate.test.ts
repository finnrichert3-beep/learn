import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseJson, JsonSyntaxError } from '../src/data/json';
import { dateProblem, validateGalaxy, validateGalaxyText } from '../src/data/validate';
import type { ValidationIssue } from '../src/data/types';

const seedPath = fileURLToPath(new URL('../public/galaxy.json', import.meta.url));
const seedText = readFileSync(seedPath, 'utf8');

const minimal = {
  clusters: [{ id: 'calc', name: 'Calculus', color: '#4d8dff' }],
  nodes: [
    { id: 'limits', label: 'Limits', cluster: 'calc', date: '2026-08-19' },
    { id: 'derivatives', label: 'Derivatives', cluster: 'calc', date: '2026-09-02', size: 3 },
  ],
  links: [['limits', 'derivatives']],
};

function issuesOf(value: unknown): ValidationIssue[] {
  const result = validateGalaxy(value);
  if (result.ok) throw new Error('expected validation to fail');
  return result.issues;
}

function textIssues(text: string): ValidationIssue[] {
  const result = validateGalaxyText(text);
  if (result.ok) throw new Error('expected validation to fail');
  return result.issues;
}

describe('seed galaxy.json', () => {
  it('is valid', () => {
    const result = validateGalaxyText(seedText);
    expect(result.ok ? [] : result.issues).toEqual([]);
  });

  it('has the clusters and node counts the brief asks for', () => {
    const result = validateGalaxyText(seedText);
    if (!result.ok) throw new Error('seed is invalid');
    const { clusters, nodes, links } = result.data;
    const school = clusters.filter((c) => c.group === 'School');
    const baseline = clusters.filter((c) => c.group === 'Baseline');
    expect(school).toHaveLength(6);
    expect(baseline).toHaveLength(7);
    for (const cluster of school) {
      const count = nodes.filter((n) => n.cluster === cluster.id).length;
      expect(count, cluster.name).toBeGreaterThanOrEqual(6);
      expect(count, cluster.name).toBeLessThanOrEqual(10);
    }
    for (const cluster of baseline) {
      const count = nodes.filter((n) => n.cluster === cluster.id).length;
      expect(count, cluster.name).toBeGreaterThanOrEqual(5);
      expect(count, cluster.name).toBeLessThanOrEqual(8);
    }
    const dates = nodes.map((n) => n.date).sort();
    expect(dates[0]?.startsWith('2026-08')).toBe(true);
    expect(dates[dates.length - 1]).toBe('2026-11-18');

    // Cross-links bridge the two super-clusters.
    const groupOf = new Map(nodes.map((n) => [n.id, clusters.find((c) => c.id === n.cluster)?.group]));
    const bridges = links.filter(([a, b]) => groupOf.get(a) !== groupOf.get(b));
    expect(bridges.length).toBeGreaterThanOrEqual(5);
  });
});

describe('validateGalaxy', () => {
  it('accepts a minimal valid file and normalises it', () => {
    const result = validateGalaxy(minimal);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.clusters[0]).toEqual({ id: 'calc', name: 'Calculus', color: '#4d8dff', group: '' });
    expect(result.data.nodes[1]?.size).toBe(3);
    expect(result.data.links).toEqual([['limits', 'derivatives']]);
  });

  it('treats links as optional', () => {
    const { links: _links, ...withoutLinks } = minimal;
    const result = validateGalaxy(withoutLinks);
    expect(result.ok && result.data.links).toEqual([]);
  });

  it('counts the same link written twice (in either order) once', () => {
    const result = validateGalaxy({
      ...minimal,
      links: [
        ['limits', 'derivatives'],
        ['derivatives', 'limits'],
        ['limits', 'derivatives'],
      ],
    });
    expect(result.ok && result.data.links).toHaveLength(1);
  });

  it('rejects a file that is not an object', () => {
    expect(issuesOf([1, 2])[0]?.message).toMatch(/must be an object/);
  });

  it('names the missing field', () => {
    const issues = issuesOf({ ...minimal, nodes: [{ id: 'limits', cluster: 'calc', date: '2026-08-19' }], links: [] });
    expect(issues).toEqual([{ path: 'nodes[0].label', message: expect.stringContaining('Missing') }]);
  });

  it('reports missing top-level lists', () => {
    const paths = issuesOf({}).map((issue) => issue.path);
    expect(paths).toEqual(['clusters', 'nodes']);
  });

  it('flags a node pointing at an unknown cluster and suggests the right one', () => {
    const issues = issuesOf({
      ...minimal,
      nodes: [{ id: 'limits', label: 'Limits', cluster: 'clac', date: '2026-08-19' }],
      links: [],
    });
    expect(issues[0]?.path).toBe('nodes[0].cluster');
    expect(issues[0]?.message).toContain('Unknown cluster "clac"');
    expect(issues[0]?.message).toContain('Did you mean "calc"?');
  });

  it.each([
    ['2026-13-01', /not a real calendar date/],
    ['2026-02-30', /not a real calendar date/],
    ['09/14/2026', /Use YYYY-MM-DD/],
    ['2026-9-4', /Use YYYY-MM-DD/],
  ])('rejects the date %s', (date, pattern) => {
    const issues = issuesOf({ ...minimal, nodes: [{ id: 'a', label: 'A', cluster: 'calc', date }], links: [] });
    expect(issues[0]?.path).toBe('nodes[0].date');
    expect(issues[0]?.message).toMatch(pattern);
  });

  it('accepts leap days', () => {
    expect(dateProblem('2028-02-29')).toBeUndefined();
    expect(dateProblem('2026-02-29')).toBeDefined();
  });

  it.each([0, 6, -1, '3', null])('rejects size %j', (size) => {
    const issues = issuesOf({
      ...minimal,
      nodes: [{ id: 'a', label: 'A', cluster: 'calc', date: '2026-08-19', size }],
      links: [],
    });
    expect(issues[0]?.path).toBe('nodes[0].size');
  });

  it('rejects duplicate ids', () => {
    const issues = issuesOf({
      clusters: [...minimal.clusters, { id: 'calc', name: 'Again', color: '#fff' }],
      nodes: [...minimal.nodes, { id: 'limits', label: 'Again', cluster: 'calc', date: '2026-08-20' }],
      links: [],
    });
    expect(issues.map((issue) => issue.path)).toEqual(['clusters[1].id', 'nodes[2].id']);
  });

  it('rejects bad colors', () => {
    const issues = issuesOf({ ...minimal, clusters: [{ id: 'calc', name: 'Calculus', color: 'blue' }] });
    expect(issues[0]?.path).toBe('clusters[0].color');
  });

  it('rejects broken links', () => {
    const issues = issuesOf({
      ...minimal,
      links: [['limits', 'nope'], ['limits'], ['limits', 'limits'], 'limits', ['limits', 7]],
    });
    expect(issues.map((issue) => issue.path)).toEqual(['links[0][1]', 'links[1]', 'links[2]', 'links[3]', 'links[4][1]']);
  });

  it('flags misspelled field names instead of silently ignoring them', () => {
    const issues = issuesOf({
      ...minimal,
      nodes: [{ id: 'a', label: 'A', cluster: 'calc', date: '2026-08-19', sise: 3 }],
      links: [],
    });
    expect(issues[0]?.path).toBe('nodes[0].sise');
    expect(issues[0]?.message).toContain('Did you mean "size"?');
  });

  it('collects every problem, not just the first', () => {
    const issues = issuesOf({
      clusters: [{ id: 'calc', name: 'Calculus', color: 'nope' }],
      nodes: [{ id: 'a', label: '', cluster: 'x', date: 'soon' }],
      links: [['a', 'b']],
    });
    expect(issues.length).toBe(5);
  });
});

describe('validateGalaxyText (line numbers)', () => {
  it('reports the line of a trailing comma', () => {
    const text = '{\n  "clusters": [\n    { "id": "calc", "name": "Calculus", "color": "#4d8dff" },\n  ],\n  "nodes": []\n}';
    const [issue] = textIssues(text);
    expect(issue?.line).toBe(3);
    expect(issue?.message).toMatch(/Trailing comma/);
  });

  it('reports the line of a missing comma', () => {
    const text = '{\n  "clusters": [\n    { "id": "a" }\n    { "id": "b" }\n  ]\n}';
    const [issue] = textIssues(text);
    expect(issue?.line).toBe(3);
    expect(issue?.message).toMatch(/Missing comma/);
  });

  it('reports an unclosed bracket', () => {
    const [issue] = textIssues('{\n  "clusters": [\n    { "id": "a" }\n');
    expect(issue?.line).toBe(2);
    expect(issue?.message).toMatch(/never closed/);
  });

  it('reports single quotes, comments and unquoted text', () => {
    expect(textIssues("{\n 'clusters': [] }")[0]).toMatchObject({ line: 2, message: expect.stringMatching(/double quotes/) });
    expect(textIssues('{\n\n // my clusters\n "clusters": [] }')[0]?.line).toBe(3);
    expect(textIssues('{ "clusters": [ { "id": calc } ] }')[0]?.message).toMatch(/double quotes/);
  });

  it('reports an empty file', () => {
    expect(textIssues('  \n')[0]?.message).toMatch(/empty/);
  });

  it('puts the line number on field errors', () => {
    const lines = seedText.split('\n');
    const index = lines.findIndex((line) => line.includes('"calc-chain"') && line.includes('"label"'));
    lines[index] = (lines[index] ?? '').replace('"cluster": "calc"', '"cluster": "calculus"');
    const [issue] = textIssues(lines.join('\n'));
    expect(issue?.line).toBe(index + 1);
    expect(issue?.path).toMatch(/^nodes\[\d+\]\.cluster$/);
    expect(issue?.message).toContain('Unknown cluster "calculus"');
  });

  it('puts the line number on a missing field (line of the item)', () => {
    const text = '{\n  "clusters": [{ "id": "c", "name": "C", "color": "#fff" }],\n  "nodes": [\n    { "id": "a", "cluster": "c", "date": "2026-08-19" }\n  ]\n}';
    expect(textIssues(text)[0]).toMatchObject({ path: 'nodes[0].label', line: 4 });
  });
});

describe('parseJson', () => {
  it('agrees with JSON.parse on valid input', () => {
    expect(parseJson(seedText).value).toEqual(JSON.parse(seedText));
    const tricky = '{"a":[1,-2.5e3,true,false,null,"x\\n\\u00e9\\"",{}],"b":{"c":[]}}';
    expect(parseJson(tricky).value).toEqual(JSON.parse(tricky));
  });

  it('tracks the line of nested values', () => {
    const parsed = parseJson('{\n  "nodes": [\n    { "id": "a" },\n    { "id": "b",\n      "date": "x" }\n  ]\n}');
    expect(parsed.lineOf('nodes')).toBe(2);
    expect(parsed.lineOf('nodes[1]')).toBe(4);
    expect(parsed.lineOf('nodes[1].date')).toBe(5);
    expect(parsed.lineOf('nodes[9]')).toBeUndefined();
  });

  it('throws JsonSyntaxError with a position', () => {
    expect(() => parseJson('{"a": 01}')).toThrow(JsonSyntaxError);
    expect(() => parseJson('{"a": 1} extra')).toThrow(/after the end/);
    try {
      parseJson('[1,\n 2,\n oops]');
    } catch (error) {
      expect(error).toMatchObject({ line: 3, column: 2 });
    }
  });
});
