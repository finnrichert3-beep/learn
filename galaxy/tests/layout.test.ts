import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateGalaxyText } from '../src/data/validate';
import { computeLayout } from '../src/layout/layout';
import type { GalaxyData } from '../src/data/types';

function seed(): GalaxyData {
  const text = readFileSync(fileURLToPath(new URL('../public/galaxy.json', import.meta.url)), 'utf8');
  const result = validateGalaxyText(text);
  if (!result.ok) throw new Error('seed is invalid');
  return result.data;
}

describe('computeLayout', () => {
  const data = seed();
  const layout = computeLayout(data);

  it('gives every node a finite position', () => {
    expect(layout.positions).toHaveLength(data.nodes.length * 3);
    expect(layout.positions.every(Number.isFinite)).toBe(true);
  });

  it('is deterministic, so nothing moves between loads', () => {
    expect(Array.from(computeLayout(data).positions)).toEqual(Array.from(layout.positions));
  });

  it('keeps every node close to its own cluster', () => {
    data.nodes.forEach((node, index) => {
      const clusterIndex = data.clusters.findIndex((cluster) => cluster.id === node.cluster);
      const cluster = layout.clusters[clusterIndex];
      if (!cluster) throw new Error('missing cluster');
      const distance = Math.hypot(
        (layout.positions[index * 3] ?? 0) - cluster.center[0],
        (layout.positions[index * 3 + 1] ?? 0) - cluster.center[1],
        (layout.positions[index * 3 + 2] ?? 0) - cluster.center[2],
      );
      expect(distance, node.id).toBeLessThanOrEqual(cluster.radius * 1.6);
    });
  });

  it('keeps clusters apart', () => {
    for (let a = 0; a < layout.clusters.length; a++) {
      for (let b = a + 1; b < layout.clusters.length; b++) {
        const ca = layout.clusters[a];
        const cb = layout.clusters[b];
        if (!ca || !cb) throw new Error('missing cluster');
        const distance = Math.hypot(ca.center[0] - cb.center[0], ca.center[1] - cb.center[1], ca.center[2] - cb.center[2]);
        expect(distance, `${data.clusters[a]?.name} vs ${data.clusters[b]?.name}`).toBeGreaterThan(30);
      }
    }
  });

  it('puts School and Baseline in two separate super-clusters', () => {
    expect(layout.groups.map((group) => group.name)).toEqual(['School', 'Baseline']);
    const xs = layout.groups.map((group) => group.center[0]);
    layout.clusters.forEach((cluster) => {
      const own = xs[cluster.group] ?? 0;
      const other = xs[1 - cluster.group] ?? 0;
      expect(Math.abs(cluster.center[0] - own)).toBeLessThan(Math.abs(cluster.center[0] - other));
    });
  });

  it('handles a single cluster with a single node', () => {
    const tiny = computeLayout({
      clusters: [{ id: 'a', name: 'A', color: '#fff', group: '' }],
      nodes: [{ id: 'n', label: 'N', cluster: 'a', date: '2026-09-01' }],
      links: [],
    });
    expect(tiny.positions.every(Number.isFinite)).toBe(true);
    expect(tiny.clusters[0]?.radius).toBeGreaterThan(0);
  });
});
