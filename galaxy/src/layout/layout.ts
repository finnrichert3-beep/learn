import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  forceZ,
  type SimNode,
} from 'd3-force-3d';
import type { GalaxyData } from '../data/types';
import { createRng, gaussian, hashString } from './rng';

export type Vec3 = [number, number, number];

export interface ClusterLayout {
  /** Centre of the cluster's nodes. */
  center: Vec3;
  /** Typical reach of the cluster's nodes from the centre (robust to a stray outlier). */
  radius: number;
  /** Unit normal of the cluster's galaxy disc. */
  normal: Vec3;
  /** Index of the super-cluster (group) this cluster belongs to. */
  group: number;
}

export interface GroupLayout {
  name: string;
  center: Vec3;
}

export interface GalaxyLayout {
  /** xyz for every node, in the order of `data.nodes`. */
  positions: Float32Array;
  /** One entry per cluster, in the order of `data.clusters`. */
  clusters: ClusterLayout[];
  groups: GroupLayout[];
}

/** Distance from the origin to each super-cluster centre is a multiple of this. */
const GROUP_SPACING = 96;
/** How far cluster centres sit from their super-cluster centre. */
const CLUSTER_ORBIT = 58;
/** Nodes are squashed towards their cluster's disc plane by this factor (1 = not at all). */
const DISC_FLATTEN = 0.5;
const SETTLE_TICKS = 320;

interface LayoutNode extends SimNode {
  id: string;
  cluster: number;
  homeX: number;
  homeY: number;
  homeZ: number;
}

interface LayoutLink {
  source: LayoutNode | string;
  target: LayoutNode | string;
  sameCluster: boolean;
  sameGroup: boolean;
}

/**
 * Lay the galaxy out in 3D and run the force simulation to rest.
 * Fully deterministic and synchronous, so the first frame already shows the final positions.
 */
export function computeLayout(data: GalaxyData): GalaxyLayout {
  const random = createRng(20260818);

  // ---- super-clusters: spread along the x axis -----------------------------
  const groupNames: string[] = [];
  for (const cluster of data.clusters) {
    if (!groupNames.includes(cluster.group)) groupNames.push(cluster.group);
  }
  const groups: GroupLayout[] = groupNames.map((name, index) => {
    const offset = index - (groupNames.length - 1) / 2;
    // A small alternating lift keeps the pair from looking like a ruler-straight line.
    const lift = groupNames.length > 1 ? (index % 2 === 0 ? 1 : -1) * 10 : 0;
    return { name, center: [offset * 2 * GROUP_SPACING, lift, 0] };
  });

  // ---- cluster centres: spread on a sphere around their super-cluster -------
  const clusterGroup = data.clusters.map((cluster) => groupNames.indexOf(cluster.group));
  const clusterHome: Vec3[] = data.clusters.map(() => [0, 0, 0]);
  const clusterNormal: Vec3[] = [];
  groups.forEach((group, groupIndex) => {
    const members = data.clusters.map((_, i) => i).filter((i) => clusterGroup[i] === groupIndex);
    const orbit = members.length === 1 ? 0 : CLUSTER_ORBIT * Math.max(0.75, Math.cbrt(members.length / 6));
    const spin = random() * Math.PI * 2;
    members.forEach((clusterIndex, k) => {
      const [dx, dy, dz] = fibonacciSphere(k, members.length, spin);
      clusterHome[clusterIndex] = [
        group.center[0] + dx * orbit,
        group.center[1] + dy * orbit * 0.8,
        group.center[2] + dz * orbit,
      ];
    });
  });
  data.clusters.forEach((cluster) => {
    const tilt = createRng(hashString(cluster.id));
    // Disc normals stay close to "up": the camera orbits around that axis from above,
    // so every mini galaxy shows its spiral from any side instead of turning edge-on.
    clusterNormal.push(normalize([gaussian(tilt) * 0.28, 1, gaussian(tilt) * 0.28]));
  });

  // ---- nodes: force simulation, pre-settled --------------------------------
  const clusterIndexById = new Map(data.clusters.map((cluster, index) => [cluster.id, index]));
  const nodes: LayoutNode[] = data.nodes.map((node) => {
    const cluster = clusterIndexById.get(node.cluster) ?? 0;
    const home = clusterHome[cluster] ?? [0, 0, 0];
    return {
      id: node.id,
      cluster,
      homeX: home[0],
      homeY: home[1],
      homeZ: home[2],
      x: home[0] + gaussian(random) * 9,
      y: home[1] + gaussian(random) * 9,
      z: home[2] + gaussian(random) * 9,
    };
  });
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const links: LayoutLink[] = data.links.map(([a, b]) => {
    const source = nodeById.get(a);
    const target = nodeById.get(b);
    const sameCluster = source?.cluster === target?.cluster;
    const sameGroup = clusterGroup[source?.cluster ?? -1] === clusterGroup[target?.cluster ?? -2];
    return { source: a, target: b, sameCluster, sameGroup };
  });

  const simulation = forceSimulation(nodes, 3)
    .randomSource(random)
    .alphaDecay(1 - Math.pow(0.001, 1 / SETTLE_TICKS))
    .velocityDecay(0.45)
    .force(
      'link',
      forceLink<LayoutNode, LayoutLink>(links)
        .id((node) => node.id)
        .distance((link) => (link.sameCluster ? 12 : 60))
        // Cross-cluster links only tug gently, so clusters stay where they belong.
        .strength((link) => (link.sameCluster ? 0.5 : link.sameGroup ? 0.012 : 0.004)),
    )
    .force('charge', forceManyBody<LayoutNode>().strength(-40).distanceMax(60))
    .force('collide', forceCollide<LayoutNode>(4.2).strength(0.9))
    .force('x', forceX<LayoutNode>((node) => node.homeX).strength(0.2))
    .force('y', forceY<LayoutNode>((node) => node.homeY).strength(0.2))
    .force('z', forceZ<LayoutNode>((node) => node.homeZ).strength(0.2))
    .stop();
  simulation.tick(SETTLE_TICKS);

  // ---- measure clusters, then flatten each one towards its disc plane -------
  const positions = new Float32Array(nodes.length * 3);
  const clusters: ClusterLayout[] = data.clusters.map((_, clusterIndex) => {
    const members = nodes.filter((node) => node.cluster === clusterIndex);
    const home = clusterHome[clusterIndex] ?? [0, 0, 0];
    const normal = clusterNormal[clusterIndex] ?? [0, 1, 0];
    const center: Vec3 = [0, 0, 0];
    if (members.length === 0) {
      return { center: [...home] as Vec3, radius: 10, normal, group: clusterGroup[clusterIndex] ?? 0 };
    }
    for (const node of members) {
      center[0] += node.x / members.length;
      center[1] += node.y / members.length;
      center[2] += node.z / members.length;
    }
    let sumSquares = 0;
    for (const node of members) {
      const dx = node.x - center[0];
      const dy = node.y - center[1];
      const dz = node.z - center[2];
      const height = dx * normal[0] + dy * normal[1] + dz * normal[2];
      const shift = height * (1 - DISC_FLATTEN);
      node.x -= normal[0] * shift;
      node.y -= normal[1] * shift;
      node.z -= normal[2] * shift;
      sumSquares += (node.x - center[0]) ** 2 + (node.y - center[1]) ** 2 + (node.z - center[2]) ** 2;
    }
    // RMS distance scaled up: close to the outer edge for an even cloud, but one node
    // dragged outwards by a cross-link doesn't inflate the whole cluster.
    const radius = Math.max(10, Math.sqrt(sumSquares / members.length) * 1.25 + 2);
    return { center, radius, normal, group: clusterGroup[clusterIndex] ?? 0 };
  });

  nodes.forEach((node, index) => {
    positions[index * 3] = node.x;
    positions[index * 3 + 1] = node.y;
    positions[index * 3 + 2] = node.z;
  });

  return { positions, clusters, groups };
}

/** k-th of n evenly spread unit vectors. */
function fibonacciSphere(k: number, n: number, spin: number): Vec3 {
  if (n === 1) return [0, 0, 0];
  const y = 1 - (2 * (k + 0.5)) / n;
  const ring = Math.sqrt(Math.max(0, 1 - y * y));
  const angle = spin + k * Math.PI * (3 - Math.sqrt(5));
  return [Math.cos(angle) * ring, y, Math.sin(angle) * ring];
}

function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}
