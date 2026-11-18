/** Shape of public/galaxy.json after validation. */

export interface Cluster {
  id: string;
  name: string;
  /** Hex color, "#rgb" or "#rrggbb". */
  color: string;
  /** Super-cluster this cluster belongs to ("School", "Baseline", ...). "" when not set. */
  group: string;
}

export interface GalaxyNode {
  id: string;
  label: string;
  /** Id of the cluster this node belongs to. */
  cluster: string;
  /** "YYYY-MM-DD" */
  date: string;
  /** Optional manual size, 1-5. When missing, size comes from the link count. */
  size?: number;
}

export type Link = readonly [string, string];

export interface GalaxyData {
  clusters: Cluster[];
  nodes: GalaxyNode[];
  links: Link[];
}

export interface ValidationIssue {
  /** Where the problem is, e.g. `nodes[12].cluster`. "" for whole-file problems. */
  path: string;
  message: string;
  /** 1-based line in galaxy.json, when known. */
  line?: number;
  column?: number;
}
