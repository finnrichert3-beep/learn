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

/** A node that is due for review is drawn on a larger sprite, to make room for its ring. */
const DUE_SPRITE_SCALE = 2.1;
/** Largest glow, and largest sprite, in device pixels. The sprite cap stays under what phone GPUs allow for points. */
const MAX_GLOW_PX = 400;
const MAX_SPRITE_PX = 500;

const vertexShader = /* glsl */ `
${FADE_GLSL}
uniform float uScale;
uniform float uPixelRatio;
uniform float uTime;
uniform float uStill;
uniform float uHover;
uniform float uFocus;
attribute vec3 aColor;
attribute float aSize;
attribute float aIndex;
varying vec3 vColor;
varying float vAlpha;
varying float vHover;
varying float vSpread;
varying float vRing;

void main() {
  vec4 state = nodeState(aIndex);
  float fade = easeFade(state.r);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;

  float hover = 1.0 - step(0.5, abs(aIndex - uHover));
  float focus = 1.0 - step(0.5, abs(aIndex - uFocus));
  float lift = max(hover, focus);
  float due = step(0.5, state.b);

  // A short flare while a node fades in, and a very slow shimmer afterwards.
  float flare = 1.0 + 0.8 * sin(fade * 3.14159265);
  float shimmer = 1.0 + 0.05 * sin(uTime * 1.1 + aIndex * 2.399);
  // Due nodes get a bigger sprite; the fragment shader shrinks the glow back and uses the rim for a ring.
  // The glow itself is sized first, then the sprite grows around it as far as the size cap allows,
  // so a node keeps the same glow whether or not it is due, even in extreme close-up.
  float glow = clamp(aSize * flare * shimmer * (1.0 + 0.5 * lift) * uScale / -mv.z, 5.0 * uPixelRatio, ${MAX_GLOW_PX.toFixed(1)});
  float sprite = min(glow * mix(1.0, ${DUE_SPRITE_SCALE.toFixed(2)}, due), ${MAX_SPRITE_PX.toFixed(1)});
  float spread = sprite / glow;
  gl_PointSize = sprite;

  // The ring grows outwards and fades, once every two seconds. Without motion it sits still.
  float phase = mix(fract(uTime * 0.5 + aIndex * 0.37), 0.42, uStill);
  vRing = due * (phase + 0.001);

  vColor = aColor;
  vAlpha = fade * state.g;
  vHover = lift;
  vSpread = spread;
}
`;

const fragmentShader = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying float vHover;
varying float vSpread;
varying float vRing;

void main() {
  float rim = length(gl_PointCoord * 2.0 - 1.0);
  if (rim > 1.0) discard;
  float d = rim * vSpread;
  float core = smoothstep(0.24, 0.04, d);
  float halo = pow(max(0.0, 1.0 - d), 2.6);
  vec3 color = vColor * (halo * (0.42 + 0.4 * vHover) + core * 1.1) + vec3(core * (0.38 + 0.5 * vHover));

  // Review ring: a thin circle that expands from the node and fades as it goes.
  if (vRing > 0.0) {
    float radius = mix(0.34, 0.94, vRing);
    float band = 1.0 - smoothstep(0.0, 0.07, abs(rim - radius));
    color += mix(vColor, vec3(1.0), 0.35) * band * pow(1.0 - vRing, 1.4) * 0.9;
  }
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
      uStill: { value: 0 },
      uHover: { value: -1 },
      uFocus: { value: -1 },
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
