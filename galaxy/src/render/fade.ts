import * as THREE from 'three';

const FADE_IN_SECONDS = 0.9;
const FADE_OUT_SECONDS = 0.35;
const TEXTURE_WIDTH = 256;

/**
 * Per-node visibility (0-1), kept in a tiny texture that every shader reads.
 * Nodes, links and particles all sample the same texture, so they can never disagree
 * about what is on screen.
 */
export class NodeFade {
  readonly texture: THREE.DataTexture;
  /** Texture size as (width, height), for index -> uv conversion in shaders. */
  readonly size: THREE.Vector2;
  private readonly alpha: Float32Array;
  private readonly target: Uint8Array;
  private readonly pixels: Uint8Array;

  constructor(readonly count: number) {
    const width = Math.min(TEXTURE_WIDTH, Math.max(1, count));
    const height = Math.max(1, Math.ceil(count / width));
    this.size = new THREE.Vector2(width, height);
    this.alpha = new Float32Array(count);
    this.target = new Uint8Array(count);
    this.pixels = new Uint8Array(width * height);
    this.texture = new THREE.DataTexture(this.pixels, width, height, THREE.RedFormat, THREE.UnsignedByteType);
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;
  }

  /** Set which nodes should be visible. With `immediate`, skip the fade. */
  setTargets(mask: readonly boolean[], immediate: boolean): void {
    for (let i = 0; i < this.count; i++) {
      const on = mask[i] ? 1 : 0;
      this.target[i] = on;
      if (immediate) this.alpha[i] = on;
    }
    if (immediate) this.upload();
  }

  /** Advance the fades. Returns true while anything is still changing. */
  update(deltaSeconds: number): boolean {
    let changed = false;
    for (let i = 0; i < this.count; i++) {
      const current = this.alpha[i] ?? 0;
      const goal = this.target[i] ?? 0;
      if (current === goal) continue;
      const step = deltaSeconds / (goal > current ? FADE_IN_SECONDS : FADE_OUT_SECONDS);
      this.alpha[i] = goal > current ? Math.min(goal, current + step) : Math.max(goal, current - step);
      changed = true;
    }
    if (changed) this.upload();
    return changed;
  }

  /** Is this node meant to be on screen right now? */
  isOn(index: number): boolean {
    return this.target[index] === 1;
  }

  /** How many nodes are meant to be on screen right now. */
  onCount(): number {
    let count = 0;
    for (let i = 0; i < this.count; i++) count += this.target[i] ?? 0;
    return count;
  }

  /** How many nodes are actually drawn with any opacity this frame. */
  drawnCount(): number {
    let count = 0;
    for (let i = 0; i < this.count; i++) if ((this.pixels[i] ?? 0) > 0) count++;
    return count;
  }

  dispose(): void {
    this.texture.dispose();
  }

  private upload(): void {
    for (let i = 0; i < this.count; i++) this.pixels[i] = Math.round((this.alpha[i] ?? 0) * 255);
    this.texture.needsUpdate = true;
  }
}

/** GLSL shared by every material that fades with its node. */
export const FADE_GLSL = /* glsl */ `
uniform sampler2D uFade;
uniform vec2 uFadeSize;

float nodeFade(float index) {
  float column = mod(index, uFadeSize.x);
  float row = floor(index / uFadeSize.x);
  float value = texture2D(uFade, vec2((column + 0.5) / uFadeSize.x, (row + 0.5) / uFadeSize.y)).r;
  return value * value * (3.0 - 2.0 * value);
}
`;
