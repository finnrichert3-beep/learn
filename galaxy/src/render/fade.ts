import * as THREE from 'three';

const FADE_IN_SECONDS = 0.9;
const FADE_OUT_SECONDS = 0.35;
const EMPHASIS_SECONDS = 0.45;
const TEXTURE_WIDTH = 256;
const CHANNELS = 4;

/**
 * Per-node state, kept in a tiny texture that every shader reads:
 *
 *   red   = visibility (0-1), driven by the timeline
 *   green = emphasis (0-1): 1 normally, lower for nodes dimmed while another node is in focus
 *   blue  = 1 when the node is due for review
 *
 * Nodes, links and particles all sample the same texture, so they can never disagree
 * about what is on screen or what is dimmed.
 */
export class NodeFade {
  readonly texture: THREE.DataTexture;
  /** Texture size as (width, height), for index -> uv conversion in shaders. */
  readonly size: THREE.Vector2;
  private readonly alpha: Float32Array;
  private readonly target: Uint8Array;
  private readonly emphasis: Float32Array;
  private readonly emphasisTarget: Float32Array;
  private readonly due: Uint8Array;
  private readonly pixels: Uint8Array;

  constructor(readonly count: number) {
    const width = Math.min(TEXTURE_WIDTH, Math.max(1, count));
    const height = Math.max(1, Math.ceil(count / width));
    this.size = new THREE.Vector2(width, height);
    this.alpha = new Float32Array(count);
    this.target = new Uint8Array(count);
    this.emphasis = new Float32Array(count).fill(1);
    this.emphasisTarget = new Float32Array(count).fill(1);
    this.due = new Uint8Array(count);
    this.pixels = new Uint8Array(width * height * CHANNELS);
    this.texture = new THREE.DataTexture(this.pixels, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.upload();
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

  /**
   * Set how bright each node should be (0-1), or null to bring every node back to full.
   * With `immediate`, skip the transition.
   */
  setEmphasis(levels: ArrayLike<number> | null, immediate: boolean): void {
    for (let i = 0; i < this.count; i++) {
      const level = levels ? Math.min(1, Math.max(0, levels[i] ?? 1)) : 1;
      this.emphasisTarget[i] = level;
      if (immediate) this.emphasis[i] = level;
    }
    if (immediate) this.upload();
  }

  /** Mark the nodes that are due for review. */
  setDue(mask: readonly boolean[]): void {
    for (let i = 0; i < this.count; i++) this.due[i] = mask[i] ? 1 : 0;
    this.upload();
  }

  /** Advance the transitions. Returns true while anything is still changing. */
  update(deltaSeconds: number): boolean {
    let changed = false;
    for (let i = 0; i < this.count; i++) {
      const current = this.alpha[i] ?? 0;
      const goal = this.target[i] ?? 0;
      if (current !== goal) {
        const step = deltaSeconds / (goal > current ? FADE_IN_SECONDS : FADE_OUT_SECONDS);
        this.alpha[i] = goal > current ? Math.min(goal, current + step) : Math.max(goal, current - step);
        changed = true;
      }
      const level = this.emphasis[i] ?? 1;
      const levelGoal = this.emphasisTarget[i] ?? 1;
      if (level !== levelGoal) {
        const step = deltaSeconds / EMPHASIS_SECONDS;
        this.emphasis[i] = levelGoal > level ? Math.min(levelGoal, level + step) : Math.max(levelGoal, level - step);
        changed = true;
      }
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
    for (let i = 0; i < this.count; i++) if ((this.pixels[i * CHANNELS] ?? 0) > 0) count++;
    return count;
  }

  /** How many nodes are currently meant to be dimmed. */
  dimmedCount(): number {
    let count = 0;
    for (let i = 0; i < this.count; i++) if ((this.emphasisTarget[i] ?? 1) < 1) count++;
    return count;
  }

  /** How many nodes are flagged as due. */
  dueCount(): number {
    let count = 0;
    for (let i = 0; i < this.count; i++) count += this.due[i] ?? 0;
    return count;
  }

  dispose(): void {
    this.texture.dispose();
  }

  private upload(): void {
    for (let i = 0; i < this.count; i++) {
      const offset = i * CHANNELS;
      this.pixels[offset] = Math.round((this.alpha[i] ?? 0) * 255);
      this.pixels[offset + 1] = Math.round((this.emphasis[i] ?? 1) * 255);
      this.pixels[offset + 2] = (this.due[i] ?? 0) * 255;
      this.pixels[offset + 3] = 255;
    }
    this.texture.needsUpdate = true;
  }
}

/** GLSL shared by every material that reads per-node state. */
export const FADE_GLSL = /* glsl */ `
uniform sampler2D uFade;
uniform vec2 uFadeSize;

// (visibility, emphasis, due, unused) for one node.
vec4 nodeState(float index) {
  float column = mod(index, uFadeSize.x);
  float row = floor(index / uFadeSize.x);
  return texture2D(uFade, vec2((column + 0.5) / uFadeSize.x, (row + 0.5) / uFadeSize.y));
}

// Ease a 0-1 visibility value so nodes fade in and out smoothly.
float easeFade(float value) {
  return value * value * (3.0 - 2.0 * value);
}
`;
