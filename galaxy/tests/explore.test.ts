import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildNeighbours, groupByCluster } from '../src/data/graph';
import { dayNumber } from '../src/data/timeline';
import { validateGalaxyText } from '../src/data/validate';
import { DEFAULT_MAX_STOPS, explorePath } from '../src/explore/path';

/** Build neighbour lists from pairs of indices. */
function graph(count: number, pairs: Array<[number, number]>): number[][] {
  const nodes = Array.from({ length: count }, (_, i) => ({ id: `n${i}`, label: '', cluster: 'c', date: '2026-09-01' }));
  return buildNeighbours({ nodes, links: pairs.map(([a, b]) => [`n${a}`, `n${b}`] as const) });
}

function expectValidWalk(path: number[], neighbours: number[][], start: number): void {
  expect(path[0]).toBe(start);
  expect(new Set(path).size).toBe(path.length);
  for (let i = 1; i < path.length; i++) {
    expect(neighbours[path[i - 1]!], `step ${i}: ${path[i - 1]} -> ${path[i]} must be a link`).toContain(path[i]);
  }
}

describe('buildNeighbours', () => {
  it('lists both ends of every link, sorted, without duplicates or self-links', () => {
    const nodes = ['a', 'b', 'c', 'd'].map((id) => ({ id, label: id, cluster: 'x', date: '2026-09-01' }));
    const neighbours = buildNeighbours({
      nodes,
      links: [
        ['c', 'a'],
        ['a', 'b'],
        ['b', 'a'],
        ['a', 'a'],
        ['a', 'ghost'],
      ],
    });
    expect(neighbours).toEqual([[1, 2], [0], [0], []]);
  });
});

describe('groupByCluster', () => {
  // node index -> cluster index
  const nodeCluster = [0, 0, 1, 2, 1, 0, 2];

  it('groups nodes by cluster, keeping their order inside each group', () => {
    expect(groupByCluster([6, 0, 2, 5, 4], nodeCluster)).toEqual([
      { cluster: 0, nodes: [0, 5] },
      { cluster: 1, nodes: [2, 4] },
      { cluster: 2, nodes: [6] },
    ]);
  });

  it('puts the chosen cluster first and the rest in file order', () => {
    expect(groupByCluster([0, 2, 3], nodeCluster, 2).map((group) => group.cluster)).toEqual([2, 0, 1]);
    expect(groupByCluster([0, 2, 3], nodeCluster, 1).map((group) => group.cluster)).toEqual([1, 0, 2]);
  });

  it('leaves out clusters with nothing in them, and counts add up', () => {
    const groups = groupByCluster([2, 4], nodeCluster, 0);
    expect(groups).toEqual([{ cluster: 1, nodes: [2, 4] }]);
    expect(groupByCluster([], nodeCluster, 0)).toEqual([]);
    const all = groupByCluster([0, 1, 2, 3, 4, 5, 6], nodeCluster);
    expect(all.reduce((sum, group) => sum + group.nodes.length, 0)).toBe(7);
  });

  it('on the seed galaxy, lists every link of Testosterone exactly once', () => {
    const text = readFileSync(fileURLToPath(new URL('../public/galaxy.json', import.meta.url)), 'utf8');
    const result = validateGalaxyText(text);
    if (!result.ok) throw new Error('seed is invalid');
    const { nodes, clusters, links } = result.data;
    const clusterOf = nodes.map((node) => clusters.findIndex((cluster) => cluster.id === node.cluster));
    const start = nodes.findIndex((node) => node.id === 'horm-testosterone');
    const linkedIds = links.filter(([a, b]) => a === 'horm-testosterone' || b === 'horm-testosterone').length;
    const groups = groupByCluster(buildNeighbours(result.data)[start] ?? [], clusterOf, clusterOf[start]);

    expect(groups[0]?.cluster).toBe(clusterOf[start]);
    expect(groups.reduce((sum, group) => sum + group.nodes.length, 0)).toBe(linkedIds);
    expect(groups.map((group) => clusters[group.cluster]?.name)).toEqual(['Hormones', 'Sleep', 'Training', 'Nutrition', 'Environment', 'Bloodwork & Labs']);
    for (const group of groups) for (const node of group.nodes) expect(clusterOf[node]).toBe(group.cluster);
  });
});

describe('explorePath', () => {
  it('follows a chain from one end to the other', () => {
    const chain = graph(5, [[0, 1], [1, 2], [2, 3], [3, 4]]);
    expect(explorePath(0, chain)).toEqual([0, 1, 2, 3, 4]);
    expect(explorePath(4, chain)).toEqual([4, 3, 2, 1, 0]);
  });

  it('from the middle of a chain takes the longer side', () => {
    const chain = graph(6, [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5]]);
    expect(explorePath(1, chain)).toEqual([1, 2, 3, 4, 5]);
  });

  it('a node without links is a route of one', () => {
    expect(explorePath(2, graph(3, [[0, 1]]))).toEqual([2]);
  });

  it('never repeats a node, even in a loop', () => {
    const ring = graph(4, [[0, 1], [1, 2], [2, 3], [3, 0]]);
    const path = explorePath(0, ring);
    expect(path).toHaveLength(4);
    expectValidWalk(path, ring, 0);
  });

  it('prefers a longer route over a dead end', () => {
    // 0 links to a dead end (1) and to a long tail (2-3-4).
    const neighbours = graph(5, [[0, 1], [0, 2], [2, 3], [3, 4]]);
    expect(explorePath(0, neighbours)).toEqual([0, 2, 3, 4]);
  });

  it('breaks ties by moving forward in time, then by index', () => {
    const star = graph(4, [[0, 1], [0, 2], [0, 3]]);
    expect(explorePath(0, star)).toEqual([0, 1]);
    // All later than the start: the soonest one wins.
    expect(explorePath(0, star, { rank: [0, 30, 10, 20] })).toEqual([0, 2]);
    expect(explorePath(0, star, { rank: [0, 5, 5, 5] })).toEqual([0, 1]);
    // A later node beats an earlier one, however close the earlier one is.
    expect(explorePath(0, star, { rank: [50, 49, 90, 10] })).toEqual([0, 2]);
    // Only earlier nodes left: the most recent one wins.
    expect(explorePath(0, star, { rank: [50, 10, 40, 30] })).toEqual([0, 2]);
  });

  it('stops at maxStops', () => {
    const chain = graph(20, Array.from({ length: 19 }, (_, i) => [i, i + 1] as [number, number]));
    expect(explorePath(0, chain)).toHaveLength(DEFAULT_MAX_STOPS);
    expect(explorePath(0, chain, { maxStops: 3 })).toEqual([0, 1, 2]);
    expect(explorePath(0, chain, { maxStops: 1 })).toEqual([0]);
  });

  it('only visits allowed nodes', () => {
    const chain = graph(5, [[0, 1], [1, 2], [2, 3], [3, 4]]);
    expect(explorePath(0, chain, { allowed: [true, true, false, true, true] })).toEqual([0, 1]);
    expect(explorePath(0, chain, { allowed: [false, true, true, true, true] })).toEqual([]);
  });

  it('returns nothing for a start that does not exist', () => {
    expect(explorePath(7, graph(2, [[0, 1]]))).toEqual([]);
    expect(explorePath(-1, graph(2, [[0, 1]]))).toEqual([]);
  });

  it('gives up cleanly on a dense graph instead of hanging', () => {
    const pairs: Array<[number, number]> = [];
    for (let a = 0; a < 40; a++) for (let b = a + 1; b < 40; b++) pairs.push([a, b]);
    const dense = graph(40, pairs);
    const path = explorePath(0, dense, { maxStops: 30, budget: 500 });
    expectValidWalk(path, dense, 0);
    expect(path.length).toBeGreaterThan(1);
  });

  describe('on the seed galaxy', () => {
    const text = readFileSync(fileURLToPath(new URL('../public/galaxy.json', import.meta.url)), 'utf8');
    const result = validateGalaxyText(text);
    if (!result.ok) throw new Error('seed is invalid');
    const data = result.data;
    const neighbours = buildNeighbours(data);
    const rank = data.nodes.map((node) => dayNumber(node.date));

    it('every node gets a valid route, and it is the same every time', () => {
      data.nodes.forEach((node, start) => {
        const path = explorePath(start, neighbours, { rank });
        expectValidWalk(path, neighbours, start);
        expect(path.length, node.id).toBeGreaterThanOrEqual(2);
        expect(path.length).toBeLessThanOrEqual(DEFAULT_MAX_STOPS);
        expect(explorePath(start, neighbours, { rank })).toEqual(path);
      });
    });

    it('respects the timeline: nothing later than the cut-off is visited', () => {
      const cutoff = dayNumber('2026-09-15');
      const allowed = rank.map((day) => day <= cutoff);
      const start = data.nodes.findIndex((node) => node.id === 'calc-limits');
      const path = explorePath(start, neighbours, { rank, allowed });
      expectValidWalk(path, neighbours, start);
      for (const node of path) expect(rank[node]).toBeLessThanOrEqual(cutoff);
      // Limits only links to Derivatives; from there the route keeps going rather than stopping at a dead end.
      expect(data.nodes[path[1]!]?.id).toBe('calc-derivatives');
      expect(path.length).toBeGreaterThan(3);
    });
  });
});
