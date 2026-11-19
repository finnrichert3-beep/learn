/**
 * The guided "Explore" route: a walk that starts at one node and moves along links,
 * one node at a time, never visiting a node twice.
 */

export interface ExploreOptions {
  /** Longest route, counting the start node. */
  maxStops?: number;
  /** Nodes that may be visited (e.g. only those the timeline currently shows). Default: all. */
  allowed?: readonly boolean[];
  /**
   * A number per node that says when it was added (its day number). When two routes are
   * equally long, the route moves forward in time first: to the linked node added soonest
   * after the current one, and only then back to earlier ones (most recent first).
   */
  rank?: readonly number[];
  /** Safety valve for very dense graphs: stop searching after this many steps. */
  budget?: number;
}

export const DEFAULT_MAX_STOPS = 8;
const DEFAULT_BUDGET = 40_000;
/** Added to the cost of stepping to an earlier node, so every later node is tried first. */
const BACKWARDS = 1e9;

/**
 * Longest route (up to `maxStops`) from `start` in which every consecutive pair is linked.
 * Ties go to the route that moves forward in time (see `rank`), then to the lower index,
 * so the result is always the same for the same data.
 */
export function explorePath(start: number, neighbours: readonly (readonly number[])[], options: ExploreOptions = {}): number[] {
  const maxStops = Math.max(1, options.maxStops ?? DEFAULT_MAX_STOPS);
  const allowed = options.allowed;
  const rank = options.rank;
  if (start < 0 || start >= neighbours.length) return [];
  if (allowed && !allowed[start]) return [];

  // Each node's onward options, best first: later nodes by how soon they follow,
  // then earlier nodes by how recently they came before.
  const ordered = neighbours.map((list, from) => {
    const origin = rank?.[from] ?? 0;
    const cost = (node: number): number => {
      const gap = (rank?.[node] ?? 0) - origin;
      return gap >= 0 ? gap : BACKWARDS - gap;
    };
    return list
      .filter((node) => !allowed || allowed[node])
      .slice()
      .sort((a, b) => cost(a) - cost(b) || a - b);
  });

  const visited = new Uint8Array(neighbours.length);
  const current: number[] = [start];
  let best: number[] = [start];
  let budget = options.budget ?? DEFAULT_BUDGET;
  visited[start] = 1;

  const walk = (node: number): boolean => {
    if (current.length > best.length) best = current.slice();
    if (best.length >= maxStops) return true;
    for (const next of ordered[node] ?? []) {
      if (visited[next]) continue;
      if (budget-- <= 0) return true;
      visited[next] = 1;
      current.push(next);
      const done = walk(next);
      current.pop();
      visited[next] = 0;
      if (done) return true;
    }
    return false;
  };
  walk(start);
  return best;
}
