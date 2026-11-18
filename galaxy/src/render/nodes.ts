import * as THREE from 'three';
import { FADE_GLSL, type NodeFade } from './fade';

export interface NodeVisualInput {
  positions: Float32Array;
  /** 1-5 size per node. */
  sizes: number[];
  /** Linear-space rgb per node. */
  colors: Float32Array;
}

/** World-space diameter of a node's glow sprite for a 1-5 size. */
export function spriteDiameter(size: number): number {
  return 4.2 + size * 1.9;
}

const vertexShader = /* glsl */ `
${FADE_GLSL}
uniform float uScale;
uniform float uPixelRatio;
uniform float uTime;
uniform float uHover;
attribute vec3 aColor;
attribute float aSize;
attribute float aIndex;
varying vec3 vColor;
varying float vAlpha;
varying float vHover;

void main() {
  float fade = nodeFade(aIndex);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;

  float hover = 1.0 - step(0.5, abs(aIndex - uHover));
  // A short flare while a node fades in, and a very slow shimmer afterwards.
  float flare = 1.0 + 0.8 * sin(fade * 3.14159265);
  float shimmer = 1.0 + 0.05 * sin(uTime * 1.1 + aIndex * 2.399);
  float size = aSize * flare * shimmer * (1.0 + 0.5 * hover) * uScale / -mv.z;
  gl_PointSize = clamp(size, 5.0 * uPixelRatio, 320.0);

  vColor = aColor;
  vAlpha = fade;
  vHover = hover;
}
`;

const fragmentShader = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying float vHover;

void main() {
  float d = length(gl_PointCoord * 2.0 - 1.0);
  if (d > 1.0) discard;
  float core = smoothstep(0.24, 0.04, d);
  float halo = pow(1.0 - d, 2.6);
  vec3 color = vColor * (halo * (0.42 + 0.4 * vHover) + core * 1.1) + vec3(core * (0.38 + 0.5 * vHover));
  gl_FragColor = vec4(color, vAlpha);
}
`;

export function createNodes(input: NodeVisualInput, fade: NodeFade): THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> {
  const count = input.sizes.length;
  const geometry = new THREE.BufferGeometry();
  const sizes = new Float32Array(count);
  const indices = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    sizes[i] = spriteDiameter(input.sizes[i] ?? 1);
    indices[i] = i;
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(input.positions, 3));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(input.colors, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aIndex', new THREE.BufferAttribute(indices, 1));

  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uFade: { value: fade.texture },
      uFadeSize: { value: fade.size },
      uScale: { value: 1 },
      uPixelRatio: { value: 1 },
      uTime: { value: 0 },
      uHover: { value: -1 },
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 3;
  return points;
}
