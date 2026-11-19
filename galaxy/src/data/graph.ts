import type { GalaxyData } from './types';

/** For every node (by index), the indices of the nodes it is linked to, in ascending order. */
export function buildNeighbours(data: Pick<GalaxyData, 'nodes' | 'links'>): number[][] {
  const indexOf = new Map(data.nodes.map((node, index) => [node.id, index]));
  const neighbours: number[][] = data.nodes.map(() => []);
  for (const [a, b] of data.links) {
    const i = indexOf.get(a);
    const j = indexOf.get(b);
    if (i === undefined || j === undefined || i === j) continue;
    if (!neighbours[i]!.includes(j)) neighbours[i]!.push(j);
    if (!neighbours[j]!.includes(i)) neighbours[j]!.push(i);
  }
  for (const list of neighbours) list.sort((x, y) => x - y);
  return neighbours;
}
