import * as THREE from 'three';
import { createRng, gaussian } from '../layout/rng';

const PARTICLES = 320;
/** How far behind the head the last particle trails, as a share of the journey. */
const TAIL = 0.5;

const vertexShader = /* glsl */ `
uniform vec3 uFrom;
uniform vec3 uTo;
uniform vec3 uColorFrom;
uniform vec3 uColorTo;
uniform float uHead;
uniform float uScale;
uniform float uPixelRatio;
attribute vec3 aJitter;
attribute vec2 aLag; // (how far behind the head, world size)
varying vec3 vColor;
varying float vAlpha;

void main() {
  // Each particle rides the straight line between the two nodes, a little behind the head.
  float along = clamp(uHead - aLag.x * ${TAIL.toFixed(2)}, 0.0, 1.0);
  float swell = sin(along * 3.14159265);
  vec3 world = mix(uFrom, uTo, along) + aJitter * (0.3 + 1.5 * swell * aLag.x);
  vec4 mv = modelViewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(aLag.y * uScale / -mv.z, 1.6 * uPixelRatio, 40.0);

  // Invisible before leaving and after arriving; brightest at the head.
  float alive = smoothstep(0.0, 0.04, along) * (1.0 - smoothstep(0.9, 1.0, along));
  vAlpha = alive * pow(1.0 - aLag.x, 1.5);
  vColor = mix(uColorFrom, uColorTo, along);
}
`;

const fragmentShader = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;

void main() {
  float d = length(gl_PointCoord * 2.0 - 1.0);
  if (d > 1.0) discard;
  gl_FragColor = vec4(mix(vColor, vec3(1.0), 0.25), vAlpha * pow(1.0 - d, 1.5));
}
`;

export interface Trail {
  points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  /** Send a streak of particles from one point to another over `seconds`. */
  launch(from: THREE.Vector3, to: THREE.Vector3, colorFrom: THREE.Color, colorTo: THREE.Color, seconds: number): void;
  /** Advance the streak. Returns true while it is still visible. */
  update(deltaSeconds: number): boolean;
  stop(): void;
}

/**
 * The particle streak that runs along a link during an Explore step.
 * One small draw call; all movement is computed in the vertex shader from a single
 * "head" uniform, so there is no per-particle JavaScript.
 */
export function createTrail(): Trail {
  const random = createRng(9001);
  const positions = new Float32Array(PARTICLES * 3);
  const jitter = new Float32Array(PARTICLES * 3);
  const lag = new Float32Array(PARTICLES * 2);
  for (let i = 0; i < PARTICLES; i++) {
    jitter[i * 3] = gaussian(random);
    jitter[i * 3 + 1] = gaussian(random);
    jitter[i * 3 + 2] = gaussian(random);
    lag[i * 2] = Math.pow(random(), 1.4);
    lag[i * 2 + 1] = 0.7 + random() * 1.5;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aJitter', new THREE.BufferAttribute(jitter, 3));
  geometry.setAttribute('aLag', new THREE.BufferAttribute(lag, 2));

  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uFrom: { value: new THREE.Vector3() },
      uTo: { value: new THREE.Vector3() },
      uColorFrom: { value: new THREE.Color(1, 1, 1) },
      uColorTo: { value: new THREE.Color(1, 1, 1) },
      uHead: { value: 0 },
      uScale: { value: 1 },
      uPixelRatio: { value: 1 },
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 4;
  points.visible = false;

  let progress = 1;
  let duration = 1;

  return {
    points,
    launch(from, to, colorFrom, colorTo, seconds) {
      (material.uniforms.uFrom!.value as THREE.Vector3).copy(from);
      (material.uniforms.uTo!.value as THREE.Vector3).copy(to);
      (material.uniforms.uColorFrom!.value as THREE.Color).copy(colorFrom);
      (material.uniforms.uColorTo!.value as THREE.Color).copy(colorTo);
      duration = Math.max(0.2, seconds);
      progress = 0;
      material.uniforms.uHead!.value = 0;
      points.visible = true;
    },
    update(deltaSeconds) {
      if (!points.visible) return false;
      progress = Math.min(1, progress + deltaSeconds / duration);
      // Same ease as the camera, stretched so the tail has arrived when the flight ends.
      const eased = progress < 0.5 ? 4 * progress ** 3 : 1 - Math.pow(-2 * progress + 2, 3) / 2;
      material.uniforms.uHead!.value = eased * (1 + TAIL);
      if (progress >= 1) points.visible = false;
      return true;
    },
    stop() {
      progress = 1;
      points.visible = false;
    },
  };
}
