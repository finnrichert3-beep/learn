import * as THREE from 'three';
import { FADE_GLSL, type NodeFade } from './fade';

export interface LinkVisualInput {
  positions: Float32Array;
  /** Linear-space rgb per node. */
  colors: Float32Array;
  /** Pairs of node indices. */
  pairs: Array<readonly [number, number]>;
  /** Per link: true when it bridges two super-clusters. */
  bridges: boolean[];
}

/** Brightness of links that don't touch the focused node, while a node is in focus. */
const OTHER_LINK_LEVEL = 0.22;

const vertexShader = /* glsl */ `
${FADE_GLSL}
uniform float uHover;
uniform float uFocus;
uniform float uFocusMix;
uniform float uOpacity;
attribute vec3 aColor;
attribute vec3 aEnds; // (node a, node b, strength)
varying vec3 vColor;
varying float vAlpha;

void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  // A link only shows once both of its nodes are on screen.
  float fade = min(easeFade(nodeState(aEnds.x).r), easeFade(nodeState(aEnds.y).r));
  float hovered = 1.0 - step(0.5, min(abs(aEnds.x - uHover), abs(aEnds.y - uHover)));
  float focused = 1.0 - step(0.5, min(abs(aEnds.x - uFocus), abs(aEnds.y - uFocus)));
  // While a node is in focus its own links light up and every other link recedes.
  float lit = max(hovered, focused * uFocusMix);
  float recede = mix(1.0, ${OTHER_LINK_LEVEL.toFixed(2)}, uFocusMix * (1.0 - focused));
  vColor = aColor;
  vAlpha = fade * uOpacity * aEnds.z * recede * (1.0 + 3.5 * lit);
}
`;

const fragmentShader = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;

void main() {
  gl_FragColor = vec4(vColor, vAlpha);
}
`;

export interface LinkLines {
  lines: THREE.LineSegments<THREE.BufferGeometry, THREE.ShaderMaterial>;
  /** Move the line ends to new node positions (xyz per node). */
  setPositions(nodePositions: Float32Array): void;
}

export function createLinks(input: LinkVisualInput, fade: NodeFade): LinkLines {
  const count = input.pairs.length;
  const positions = new Float32Array(count * 6);
  const colors = new Float32Array(count * 6);
  const ends = new Float32Array(count * 6);

  input.pairs.forEach(([a, b], link) => {
    const strength = input.bridges[link] ? 1.3 : 1;
    [a, b].forEach((node, corner) => {
      const offset = (link * 2 + corner) * 3;
      for (let axis = 0; axis < 3; axis++) {
        colors[offset + axis] = input.colors[node * 3 + axis] ?? 1;
      }
      ends[offset] = a;
      ends[offset + 1] = b;
      ends[offset + 2] = strength;
    });
  });

  const geometry = new THREE.BufferGeometry();
  const positionAttribute = new THREE.BufferAttribute(positions, 3);
  geometry.setAttribute('position', positionAttribute);
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aEnds', new THREE.BufferAttribute(ends, 3));

  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uFade: { value: fade.texture },
      uFadeSize: { value: fade.size },
      uHover: { value: -1 },
      uFocus: { value: -1 },
      uFocusMix: { value: 0 },
      uOpacity: { value: 0.11 },
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
  });

  const lines = new THREE.LineSegments(geometry, material);
  lines.frustumCulled = false;
  lines.renderOrder = 1;

  const setPositions = (nodePositions: Float32Array): void => {
    input.pairs.forEach(([a, b], link) => {
      for (let axis = 0; axis < 3; axis++) {
        positions[link * 6 + axis] = nodePositions[a * 3 + axis] ?? 0;
        positions[link * 6 + 3 + axis] = nodePositions[b * 3 + axis] ?? 0;
      }
    });
    positionAttribute.needsUpdate = true;
  };
  setPositions(input.positions);

  return { lines, setPositions };
}
