import * as THREE from 'three';
import { createRng } from '../layout/rng';

const vertexShader = /* glsl */ `
uniform float uPixelRatio;
uniform float uTime;
attribute vec3 aStar; // (size in px, brightness, twinkle phase)
varying float vAlpha;

void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aStar.x * uPixelRatio;
  vAlpha = aStar.y * (1.0 + 0.25 * sin(uTime * 0.6 + aStar.z));
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uTint;
varying float vAlpha;

void main() {
  float d = length(gl_PointCoord * 2.0 - 1.0);
  if (d > 1.0) discard;
  gl_FragColor = vec4(uTint, vAlpha * (1.0 - d));
}
`;

/** A faint shell of distant stars. It is moved with the camera to create parallax. */
export function createStarfield(count: number, radius: number): THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> {
  const random = createRng(4242);
  const positions = new Float32Array(count * 3);
  const stars = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    // Even spread over a thick spherical shell.
    const y = random() * 2 - 1;
    const ring = Math.sqrt(1 - y * y);
    const angle = random() * Math.PI * 2;
    const distance = radius * (0.7 + random() * 0.6);
    positions[i * 3] = Math.cos(angle) * ring * distance;
    positions[i * 3 + 1] = y * distance;
    positions[i * 3 + 2] = Math.sin(angle) * ring * distance;
    const bright = random() < 0.06;
    stars[i * 3] = bright ? 2.2 + random() * 1.2 : 1.1 + random() * 0.9;
    stars[i * 3 + 1] = bright ? 0.5 + random() * 0.3 : 0.12 + random() * 0.26;
    stars[i * 3 + 2] = random() * Math.PI * 2;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aStar', new THREE.BufferAttribute(stars, 3));

  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uPixelRatio: { value: 1 },
      uTime: { value: 0 },
      uTint: { value: new THREE.Color(0.78, 0.85, 1.0) },
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 0;
  return points;
}
