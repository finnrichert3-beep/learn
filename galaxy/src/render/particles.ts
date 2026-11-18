import * as THREE from 'three';
import type { ClusterLayout, Vec3 } from '../layout/layout';
import { createRng, gaussian, hashString } from '../layout/rng';
import { FADE_GLSL, type NodeFade } from './fade';

export const MIN_PARTICLES_PER_CLUSTER = 1000;
export const MAX_PARTICLES_PER_CLUSTER = 4000;
const BASE_OPACITY = 0.3;

export interface ParticleClusterInput {
  id: string;
  layout: ClusterLayout;
  /** Linear-space rgb. */
  color: [number, number, number];
  /** Indices (into the node list) of this cluster's nodes. */
  nodes: number[];
  /** 1-5 size of each of those nodes, used to share particles out. */
  nodeSizes: number[];
}

/** Particles for one cluster: more nodes means a slightly denser cloud, always within 1,000-4,000. */
export function particleCountFor(nodeCount: number, base: number): number {
  const count = Math.round(base * (0.6 + 0.05 * nodeCount));
  return Math.min(MAX_PARTICLES_PER_CLUSTER, Math.max(MIN_PARTICLES_PER_CLUSTER, count));
}

const vertexShader = /* glsl */ `
${FADE_GLSL}
uniform float uTime;
uniform float uScale;
uniform float uPixelRatio;
uniform float uOpacity;
uniform mat3 uArrange;
attribute vec3 aU;
attribute vec3 aV;
attribute vec4 aOrbit; // (radius, start angle, height, phase)
attribute vec3 aMisc;  // (world size, owner node index, angular speed)
attribute vec3 aColor;
varying vec3 vColor;
varying float vAlpha;

void main() {
  // Every particle belongs to one node and fades in with it.
  float fade = nodeFade(aMisc.y);

  // Swirl: each particle circles its cluster centre in the plane spanned by aU / aV.
  float angle = aOrbit.y + uTime * aMisc.z;
  float radius = aOrbit.x * mix(0.6, 1.0, fade) * (1.0 + 0.03 * sin(uTime * 0.23 + aOrbit.w));
  float height = aOrbit.z + 0.5 * sin(uTime * 0.19 + aOrbit.w * 1.7);
  vec3 normal = cross(aU, aV);
  vec3 world = uArrange * position + (aU * cos(angle) + aV * sin(angle)) * radius + normal * height;

  vec4 mv = modelViewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mv;

  // Keep points at least ~1.3px wide; dim them instead of letting them flicker below that.
  float size = aMisc.x * uScale / -mv.z;
  float minSize = 1.3 * uPixelRatio;
  float dim = clamp((size * size) / (minSize * minSize), 0.5, 1.0);
  gl_PointSize = clamp(size, minSize, 48.0);

  vColor = aColor;
  vAlpha = fade * uOpacity * dim;
}
`;

const fragmentShader = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;

void main() {
  float d = length(gl_PointCoord * 2.0 - 1.0);
  if (d > 1.0) discard;
  float glow = pow(1.0 - d, 1.6);
  gl_FragColor = vec4(vColor, vAlpha * glow);
}
`;

export interface ParticleField {
  points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  /** Total particles at full quality. */
  total: number;
  /** Draw only this fraction (0-1) of the particles. Thins every cluster evenly. */
  setFraction(fraction: number): number;
}

/**
 * One draw call for every cluster's particle cloud. All motion happens in the vertex
 * shader from static per-particle attributes; JavaScript only updates a time uniform.
 */
export function createParticles(clusters: ParticleClusterInput[], fade: NodeFade, basePerCluster: number): ParticleField {
  const counts = clusters.map((cluster) => (cluster.nodes.length === 0 ? 0 : particleCountFor(cluster.nodes.length, basePerCluster)));
  const total = counts.reduce((sum, count) => sum + count, 0);

  const center = new Float32Array(total * 3);
  const basisU = new Float32Array(total * 3);
  const basisV = new Float32Array(total * 3);
  const orbit = new Float32Array(total * 4);
  const misc = new Float32Array(total * 3);
  const color = new Float32Array(total * 3);

  // Particles are written in shuffled order so that drawing only the first N of them
  // (when the frame rate drops) thins every cluster evenly instead of deleting whole clusters.
  const order = shuffledOrder(total, createRng(77));
  let cursor = 0;

  clusters.forEach((cluster, clusterIndex) => {
    const count = counts[clusterIndex] ?? 0;
    if (count === 0) return;
    const random = createRng(hashString(cluster.id) ^ 0x9e3779b9);
    const { center: c, normal, radius: clusterRadius } = cluster.layout;
    const [u, v] = discBasis(normal);
    const reach = clusterRadius * 1.3;
    const direction = random() < 0.5 ? -1 : 1;
    const baseSpeed = direction * (0.035 + random() * 0.025);
    const arms = random() < 0.35 ? 3 : 2;
    const twist = 3.0 + random() * 1.3;
    const armOffset = random() * Math.PI * 2;
    const pickOwner = weightedPicker(cluster.nodes, cluster.nodeSizes);

    for (let k = 0; k < count; k++) {
      const slot = order[cursor++] ?? 0;
      const kind = random();
      let radius: number;
      let angle: number;
      let height: number;
      let brightness: number;
      let whiten: number;

      if (kind < 0.16) {
        // Bright central bulge.
        radius = Math.abs(gaussian(random)) * reach * 0.13;
        angle = random() * Math.PI * 2;
        height = gaussian(random) * reach * 0.07;
        brightness = 0.7 + random() * 0.5;
        whiten = 0.35;
      } else if (kind < 0.84) {
        // Spiral arms that trail the direction of rotation.
        const t = Math.pow(random(), 0.8);
        radius = (0.1 + 0.9 * t) * reach;
        const arm = Math.floor(random() * arms);
        angle = armOffset + (arm / arms) * Math.PI * 2 - direction * t * twist + gaussian(random) * (0.09 + 0.15 * t);
        height = gaussian(random) * reach * 0.05 * (1 - 0.4 * t);
        brightness = 0.45 + random() * 0.55;
        whiten = 0.08;
      } else {
        // Loose disc and halo between the arms.
        radius = Math.sqrt(random()) * reach * 1.12;
        angle = random() * Math.PI * 2;
        height = gaussian(random) * reach * 0.09;
        brightness = 0.25 + random() * 0.4;
        whiten = 0;
      }

      const big = random() < 0.04;
      const worldSize = big ? 1.6 + random() * 0.9 : 0.55 + random() * 0.65;
      // Inner particles orbit a little faster than outer ones.
      const speed = baseSpeed * (1 + 0.3 * (1 - Math.min(1, radius / reach)));

      const p3 = slot * 3;
      const p4 = slot * 4;
      center.set(c, p3);
      basisU.set(u, p3);
      basisV.set(v, p3);
      orbit[p4] = radius;
      orbit[p4 + 1] = angle;
      orbit[p4 + 2] = height;
      orbit[p4 + 3] = random() * Math.PI * 2;
      misc[p3] = worldSize;
      misc[p3 + 1] = pickOwner(random());
      misc[p3 + 2] = speed;
      for (let channel = 0; channel < 3; channel++) {
        const base = cluster.color[channel as 0 | 1 | 2];
        color[p3 + channel] = (base + (1 - base) * whiten) * brightness;
      }
    }
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(center, 3));
  geometry.setAttribute('aU', new THREE.BufferAttribute(basisU, 3));
  geometry.setAttribute('aV', new THREE.BufferAttribute(basisV, 3));
  geometry.setAttribute('aOrbit', new THREE.BufferAttribute(orbit, 4));
  geometry.setAttribute('aMisc', new THREE.BufferAttribute(misc, 3));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(color, 3));

  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uFade: { value: fade.texture },
      uFadeSize: { value: fade.size },
      uTime: { value: 0 },
      uScale: { value: 1 },
      uPixelRatio: { value: 1 },
      uOpacity: { value: BASE_OPACITY },
      uArrange: { value: new THREE.Matrix3() },
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 2;

  return {
    points,
    total,
    setFraction(fraction: number): number {
      const drawn = Math.max(0, Math.min(total, Math.round(total * fraction)));
      geometry.setDrawRange(0, drawn);
      // Fewer particles are drawn a touch brighter so the clouds keep their presence.
      material.uniforms.uOpacity!.value = BASE_OPACITY * Math.min(1.6, 1 / Math.sqrt(Math.max(0.2, fraction)));
      return drawn;
    },
  };
}

/** Two unit vectors spanning the plane perpendicular to `normal`. */
function discBasis(normal: Vec3): [Vec3, Vec3] {
  const n = new THREE.Vector3(...normal).normalize();
  const helper = Math.abs(n.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(helper, n).normalize();
  const v = new THREE.Vector3().crossVectors(n, u).normalize();
  return [u.toArray() as Vec3, v.toArray() as Vec3];
}

function shuffledOrder(count: number, random: () => number): Uint32Array {
  const order = new Uint32Array(count);
  for (let i = 0; i < count; i++) order[i] = i;
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const swap = order[i] ?? 0;
    order[i] = order[j] ?? 0;
    order[j] = swap;
  }
  return order;
}

/** Returns a function mapping a 0-1 random value to one of `items`, weighted by `weights`. */
function weightedPicker(items: number[], weights: number[]): (random: number) => number {
  const cumulative: number[] = [];
  let sum = 0;
  items.forEach((_, index) => {
    sum += 0.6 + (weights[index] ?? 1) * 0.4;
    cumulative.push(sum);
  });
  return (random) => {
    const goal = random * sum;
    for (let i = 0; i < cumulative.length; i++) {
      if (goal <= (cumulative[i] ?? 0)) return items[i] ?? 0;
    }
    return items[items.length - 1] ?? 0;
  };
}
