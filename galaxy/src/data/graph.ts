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

export interface ClusterGroup {
  /** Cluster index. */
  cluster: number;
  /** Node indices in that cluster, in the order they were given. */
  nodes: number[];
}

/**
 * Split a list of nodes into groups by cluster. The `first` cluster (usually the one the
 * current node belongs to) leads; the others follow in the order clusters are listed in the file.
 * Clusters with no nodes are left out.
 */
export function groupByCluster(nodes: readonly number[], nodeCluster: readonly number[], first = -1): ClusterGroup[] {
  const byCluster = new Map<number, number[]>();
  for (const node of nodes) {
    const cluster = nodeCluster[node];
    if (cluster === undefined) continue;
    const list = byCluster.get(cluster);
    if (list) list.push(node);
    else byCluster.set(cluster, [node]);
  }
  return [...byCluster.entries()]
    .sort(([a], [b]) => (a === first ? -1 : b === first ? 1 : a - b))
    .map(([cluster, list]) => ({ cluster, nodes: list }));
}
