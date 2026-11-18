import type { GalaxyData, Link } from './types';

export const MIN_SIZE = 1;
export const MAX_SIZE = 5;
/** Each link adds this much size, so 8 or more links reaches the maximum. */
const SIZE_PER_LINK = 0.5;

/** Number of links touching each node id. Nodes without links are not in the map. */
export function linkCounts(links: readonly Link[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const [a, b] of links) {
    counts.set(a, (counts.get(a) ?? 0) + 1);
    counts.set(b, (counts.get(b) ?? 0) + 1);
  }
  return counts;
}

/**
 * Size of one node on the 1-5 scale.
 * A manual `size` always wins; otherwise the size grows with the link count.
 */
export function nodeSize(manualSize: number | undefined, linkCount: number): number {
  if (manualSize !== undefined) return clamp(manualSize, MIN_SIZE, MAX_SIZE);
  return clamp(MIN_SIZE + Math.max(0, linkCount) * SIZE_PER_LINK, MIN_SIZE, MAX_SIZE);
}

/** Sizes for every node, in the same order as `data.nodes`. */
export function computeSizes(data: Pick<GalaxyData, 'nodes' | 'links'>): number[] {
  const counts = linkCounts(data.links);
  return data.nodes.map((node) => nodeSize(node.size, counts.get(node.id) ?? 0));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
