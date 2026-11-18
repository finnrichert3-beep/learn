import { describe, expect, it } from 'vitest';
import { computeSizes, linkCounts, nodeSize } from '../src/data/sizing';
import type { GalaxyNode, Link } from '../src/data/types';

const node = (id: string, size?: number): GalaxyNode =>
  size === undefined ? { id, label: id, cluster: 'c', date: '2026-09-01' } : { id, label: id, cluster: 'c', date: '2026-09-01', size };

describe('linkCounts', () => {
  it('counts both ends of every link', () => {
    const links: Link[] = [
      ['a', 'b'],
      ['a', 'c'],
      ['c', 'b'],
      ['a', 'd'],
    ];
    const counts = linkCounts(links);
    expect(counts.get('a')).toBe(3);
    expect(counts.get('b')).toBe(2);
    expect(counts.get('c')).toBe(2);
    expect(counts.get('d')).toBe(1);
    expect(counts.get('nobody')).toBeUndefined();
  });

  it('is empty without links', () => {
    expect(linkCounts([]).size).toBe(0);
  });
});

describe('nodeSize', () => {
  it('starts at 1 with no links and grows by 0.5 per link', () => {
    expect(nodeSize(undefined, 0)).toBe(1);
    expect(nodeSize(undefined, 1)).toBe(1.5);
    expect(nodeSize(undefined, 4)).toBe(3);
  });

  it('caps at 5', () => {
    expect(nodeSize(undefined, 8)).toBe(5);
    expect(nodeSize(undefined, 40)).toBe(5);
  });

  it('never shrinks as links are added', () => {
    let previous = 0;
    for (let links = 0; links <= 12; links++) {
      const size = nodeSize(undefined, links);
      expect(size).toBeGreaterThanOrEqual(previous);
      previous = size;
    }
  });

  it('lets a manual size override the link count', () => {
    expect(nodeSize(2, 10)).toBe(2);
    expect(nodeSize(5, 0)).toBe(5);
  });

  it('keeps manual sizes inside 1-5', () => {
    expect(nodeSize(9, 0)).toBe(5);
    expect(nodeSize(0, 0)).toBe(1);
  });
});

describe('computeSizes', () => {
  it('returns one size per node, in order', () => {
    const nodes = [node('hub'), node('leaf'), node('loner'), node('manual', 4)];
    const links: Link[] = [
      ['hub', 'leaf'],
      ['hub', 'manual'],
    ];
    expect(computeSizes({ nodes, links })).toEqual([2, 1.5, 1, 4]);
  });
});
