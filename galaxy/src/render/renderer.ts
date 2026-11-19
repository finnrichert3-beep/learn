import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import type { GalaxyData } from '../data/types';
import type { GalaxyLayout } from '../layout/layout';
import { NodeFade } from './fade';
import { createLinks, type LinkLines } from './links';
import { createNodes, spriteDiameter } from './nodes';
import { createParticles, type ParticleField } from './particles';
import { PerfMonitor, QUALITY_TIERS } from './perf';
import { createStarfield } from './starfield';
import { createTrail, type Trail } from './trail';

export interface RendererOptions {
  /** prefers-reduced-motion: no auto-rotate, no drift, no swirl, static bloom. */
  reducedMotion: boolean;
  /** Phones and tablets start with fewer particles. */
  mobile: boolean;
  /** Keep full quality even when FPS drops (for screenshots and benchmarking). */
  lockQuality: boolean;
}

/** Screen space covered by UI, in CSS pixels. The galaxy is framed in what is left. */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface RenderStats {
  fps: number;
  frameMs: number;
  tier: number;
  particles: number;
  particlesTotal: number;
  pixelRatio: number;
  width: number;
  height: number;
  /** Nodes that are meant to be visible. */
  nodesOn: number;
  /** Nodes drawn with any opacity in the last frame. */
  nodesDrawn: number;
  autoRotating: boolean;
  camera: [number, number, number];
  /** Node in focus (detail mode), or -1. */
  focus: number;
  /** Nodes dimmed because another node is in focus. */
  nodesDimmed: number;
  /** Nodes showing the "due for review" ring. */
  nodesDue: number;
  /** True while a camera flight is in progress. */
  flying: boolean;
  /** True while the Explore particle trail is on screen. */
  trailActive: boolean;
}

export interface ScreenPoint {
  x: number;
  y: number;
  /** Radius of the node's bright core, in CSS pixels. */
  radius: number;
  inView: boolean;
}

const FOV = 45;
const BLOOM_STRENGTH = 0.8;
const BLOOM_RADIUS = 0.5;
const BLOOM_THRESHOLD = 0.08;
const AUTO_ROTATE_SPEED = 0.42;
const IDLE_RESUME_MS = 5000;
/** Camera angles checked when framing the overview. */
const FIT_AZIMUTHS = 16;
/** Upper bound on rendered pixels (about a 15-inch retina laptop at full resolution). */
const MAX_PIXELS = 7_000_000;
/** Share of the remaining glide removed per 60fps frame. */
const DAMPING_PER_FRAME = 0.1;
const FLY_SECONDS = 1.5;
const NODE_FLY_SECONDS = 1.15;
/** Brightness of nodes outside the focused node's neighbourhood. */
const DIM_LEVEL = 0.1;
/** How quickly the picture re-centres when a panel opens or closes (higher is faster). */
const SHIFT_RATE = 7;
const STAR_PARALLAX = 0.9;
/** Height of the overview camera relative to its distance in front (0.62 is about 32 degrees up). */
const CAMERA_LIFT = 0.62;

export class GalaxyRenderer {
  /** Called once per animation frame, before anything is drawn. */
  onFrame: ((deltaSeconds: number) => void) | null = null;
  /** Called after a frame was actually drawn. */
  onAfterRender: (() => void) | null = null;
  /** Called when the user starts dragging, zooming or panning. */
  onInteract: (() => void) | null = null;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(FOV, 1, 1, 8000);
  private readonly controls: OrbitControls;
  private readonly root = new THREE.Group();
  private readonly fade: NodeFade;
  private readonly nodes: ReturnType<typeof createNodes>;
  private readonly links: LinkLines;
  private readonly particles: ParticleField;
  private readonly stars: ReturnType<typeof createStarfield>;
  private readonly perf: PerfMonitor;
  private readonly trail: Trail;

  private readonly nodeCount: number;
  private readonly nodeColors: Float32Array;
  /** Node positions exactly as the layout produced them. */
  private readonly layoutPositions: Float32Array;
  /** Node positions as drawn: the layout with the cluster arrangement turned to suit the screen. */
  private readonly positions: Float32Array;
  private readonly nodeCluster: number[];
  private readonly arrange = new THREE.Matrix4();
  private readonly spriteSizes: Float32Array;
  private readonly scratch = new THREE.Vector3();

  private width = 1;
  private height = 1;
  private pixelRatio = 1;
  /** Space taken by the permanent UI. The overview is framed inside what is left. */
  private insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
  /** Space taken by the UI right now, including an open detail panel. Decides where the picture is centred. */
  private viewInsets: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
  private readonly shift = new THREE.Vector2();
  private readonly shiftTarget = new THREE.Vector2();
  private shiftReady = false;
  private particlesDrawn = 0;

  private focus = -1;
  private focusMix = 0;
  private readonly emphasisLevels: Float32Array;

  private raf = 0;
  private lastFrame = 0;
  private time = 0;
  private dirty = true;
  private running = false;

  private idleTimer = 0;
  private rotateSpeed = 0;
  private atHome = true;
  /** What the camera was last sent to look at, so it can follow if a resize moves it. */
  private anchor: { kind: 'node' | 'cluster'; index: number } | null = null;
  private readonly homePosition = new THREE.Vector3();
  private readonly homeTarget = new THREE.Vector3();
  private fly: {
    fromPosition: THREE.Vector3;
    fromTarget: THREE.Vector3;
    toPosition: THREE.Vector3;
    toTarget: THREE.Vector3;
    progress: number;
    seconds: number;
  } | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    data: GalaxyData,
    private readonly layout: GalaxyLayout,
    sizes: number[],
    private readonly options: RendererOptions,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.toneMapping = THREE.NoToneMapping;

    // ---- per-node data -------------------------------------------------------
    this.nodeCount = data.nodes.length;
    this.layoutPositions = layout.positions;
    this.positions = new Float32Array(layout.positions);
    this.spriteSizes = Float32Array.from(sizes, spriteDiameter);

    const clusterIndex = new Map(data.clusters.map((cluster, index) => [cluster.id, index]));
    const clusterColors = data.clusters.map((cluster) => new THREE.Color(cluster.color));
    const nodeCluster = data.nodes.map((node) => clusterIndex.get(node.cluster) ?? 0);
    this.nodeCluster = nodeCluster;
    const nodeColors = new Float32Array(this.nodeCount * 3);
    this.nodeColors = nodeColors;
    this.emphasisLevels = new Float32Array(this.nodeCount);
    nodeCluster.forEach((cluster, node) => {
      const color = clusterColors[cluster] ?? new THREE.Color(1, 1, 1);
      nodeColors.set([color.r, color.g, color.b], node * 3);
    });

    this.fade = new NodeFade(this.nodeCount);

    // ---- scene ---------------------------------------------------------------
    this.nodes = createNodes({ positions: this.positions, sizes, colors: nodeColors }, this.fade);

    const nodeIndex = new Map(data.nodes.map((node, index) => [node.id, index]));
    const pairs = data.links.map(([a, b]) => [nodeIndex.get(a) ?? 0, nodeIndex.get(b) ?? 0] as const);
    const bridges = pairs.map(([a, b]) => {
      const groupA = layout.clusters[nodeCluster[a] ?? 0]?.group;
      const groupB = layout.clusters[nodeCluster[b] ?? 0]?.group;
      return groupA !== groupB;
    });
    this.links = createLinks({ positions: this.positions, colors: nodeColors, pairs, bridges }, this.fade);

    this.particles = createParticles(
      data.clusters.map((cluster, index) => {
        const members = nodeCluster.map((c, node) => (c === index ? node : -1)).filter((node) => node >= 0);
        const color = clusterColors[index] ?? new THREE.Color(1, 1, 1);
        return {
          id: cluster.id,
          layout: layout.clusters[index] ?? { center: [0, 0, 0], radius: 10, normal: [0, 1, 0], group: 0 },
          color: [color.r, color.g, color.b],
          nodes: members,
          nodeSizes: members.map((node) => sizes[node] ?? 1),
        };
      }),
      this.fade,
      options.mobile ? 1600 : 2600,
    );

    this.stars = createStarfield(options.mobile ? 1400 : 2200, 1700);

    this.nodes.material.uniforms.uStill!.value = options.reducedMotion ? 1 : 0;
    this.trail = createTrail();

    this.root.add(this.links.lines, this.particles.points, this.nodes, this.trail.points);
    this.scene.add(this.stars, this.root);

    // ---- post-processing -----------------------------------------------------
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    // ---- controls ------------------------------------------------------------
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = !options.reducedMotion;
    this.controls.rotateSpeed = 0.7;
    this.controls.zoomSpeed = 0.9;
    this.controls.panSpeed = 0.8;
    this.controls.minDistance = 22;
    this.controls.autoRotate = !options.reducedMotion;
    this.controls.autoRotateSpeed = 0;
    this.controls.addEventListener('start', this.handleInteractionStart);
    this.controls.addEventListener('end', this.handleInteractionEnd);
    this.controls.addEventListener('change', this.markDirty);

    this.perf = new PerfMonitor(QUALITY_TIERS.length, {}, options.lockQuality);
    this.applyTier();

    canvas.addEventListener('webglcontextlost', this.handleContextLost);
    canvas.addEventListener('webglcontextrestored', this.markDirty);
    document.addEventListener('visibilitychange', this.handleVisibility);
  }

  // ---- lifecycle -------------------------------------------------------------

  start(): void {
    if (this.running || document.hidden) return;
    this.running = true;
    this.lastFrame = 0;
    this.raf = requestAnimationFrame(this.tick);
  }

  /** Stop the render loop completely (used while the tab is hidden). */
  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.perf.reset();
  }

  dispose(): void {
    this.stop();
    window.clearTimeout(this.idleTimer);
    document.removeEventListener('visibilitychange', this.handleVisibility);
    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.markDirty);
    this.controls.dispose();
    this.fade.dispose();
    for (const object of [this.nodes, this.links.lines, this.particles.points, this.stars, this.trail.points]) {
      object.geometry.dispose();
      object.material.dispose();
    }
    this.bloom.dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }

  get isRunning(): boolean {
    return this.running;
  }

  // ---- size & framing --------------------------------------------------------

  /**
   * `insets` is the space the permanent UI covers; the overview is framed in the rest.
   * `viewInsets` also counts an open detail panel, and decides where the picture is centred.
   */
  resize(width: number, height: number, insets: Insets, viewInsets: Insets = insets): void {
    this.width = Math.max(1, Math.round(width));
    this.height = Math.max(1, Math.round(height));
    this.insets = insets;
    this.viewInsets = viewInsets;
    this.camera.aspect = this.width / this.height;
    this.applyPixelRatio();
    this.frame();
    this.aimViewShift();
    this.dirty = true;
  }

  /** Tell the renderer how much of the screen the UI covers right now (a panel opened or closed). */
  setViewInsets(viewInsets: Insets): void {
    this.viewInsets = viewInsets;
    this.aimViewShift();
    this.dirty = true;
  }

  /** Usable part of the screen for a set of insets, in CSS pixels. */
  private freeArea(insets: Insets): { width: number; height: number } {
    return {
      width: Math.max(80, this.width - insets.left - insets.right),
      height: Math.max(80, this.height - insets.top - insets.bottom),
    };
  }

  /** Work out where the picture's centre should sit, and go there (at once the first time). */
  private aimViewShift(): void {
    const free = this.freeArea(this.viewInsets);
    this.shiftTarget.set(
      this.width / 2 - (this.viewInsets.left + free.width / 2),
      this.height / 2 - (this.viewInsets.top + free.height / 2),
    );
    if (!this.shiftReady || this.options.reducedMotion) {
      this.shiftReady = true;
      this.shift.copy(this.shiftTarget);
    }
    this.applyViewShift();
  }

  private applyViewShift(): void {
    this.camera.setViewOffset(this.width, this.height, this.shift.x, this.shift.y, this.width, this.height);
  }

  /** Glide the picture's centre towards its target. Returns true while it is moving. */
  private updateViewShift(deltaSeconds: number): boolean {
    if (this.shift.equals(this.shiftTarget)) return false;
    this.shift.lerp(this.shiftTarget, 1 - Math.exp(-deltaSeconds * SHIFT_RATE));
    if (this.shift.distanceTo(this.shiftTarget) < 0.5) this.shift.copy(this.shiftTarget);
    this.applyViewShift();
    return true;
  }

  private applyPixelRatio(): void {
    const tier = QUALITY_TIERS[this.perf.tier] ?? QUALITY_TIERS[0]!;
    // Never shade more than MAX_PIXELS per frame, however large or dense the display is.
    const budget = Math.sqrt(MAX_PIXELS / (this.width * this.height));
    this.pixelRatio = Math.max(0.75, Math.min(window.devicePixelRatio || 1, tier.maxPixelRatio, budget));
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(this.width, this.height, false);
    this.composer.setPixelRatio(this.pixelRatio);
    this.composer.setSize(this.width, this.height);

    // World units -> device pixels at distance 1, for size attenuation in the shaders.
    const scale = (this.height * this.pixelRatio) / (2 * Math.tan(THREE.MathUtils.degToRad(FOV) / 2));
    for (const material of [this.nodes.material, this.particles.points.material, this.trail.points.material]) {
      material.uniforms.uScale!.value = scale;
      material.uniforms.uPixelRatio!.value = this.pixelRatio;
    }
    this.stars.material.uniforms.uPixelRatio!.value = this.pixelRatio;
  }

  private applyTier(): void {
    const tier = QUALITY_TIERS[this.perf.tier] ?? QUALITY_TIERS[0]!;
    this.particlesDrawn = this.particles.setFraction(tier.particleFraction);
    this.applyPixelRatio();
    this.dirty = true;
  }

  /** Work out the overview camera pose for the current screen, and snap to it if the user hasn't moved. */
  private frame(): void {
    const { width: freeWidth, height: freeHeight } = this.freeArea(this.insets);

    // The two super-clusters sit side by side on wide screens and stacked on tall ones.
    // Re-arranging moves every node, so a camera that is looking at one has to move with it.
    const portrait = THREE.MathUtils.smoothstep(1.25 - freeWidth / freeHeight, 0, 0.45);
    const before = this.anchorPoint();
    this.arrangeClusters(-portrait * (Math.PI / 2));
    const after = this.anchorPoint();
    if (before && after && !this.atHome) {
      const moved = after.sub(before);
      this.camera.position.add(moved);
      this.controls.target.add(moved);
      if (this.fly) {
        for (const point of [this.fly.fromPosition, this.fly.fromTarget, this.fly.toPosition, this.fly.toTarget]) point.add(moved);
      }
      this.controls.update();
    }

    // Find the closest camera distance at which every cluster still fits in the free area.
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(FOV) / 2);
    const verticalReach = tanHalf * (freeHeight / this.height);
    const horizontalReach = tanHalf * this.camera.aspect * (freeWidth / this.width);
    const toCamera = new THREE.Vector3(0, CAMERA_LIFT, 1).normalize();
    const forward = toCamera.clone().negate();
    const right = new THREE.Vector3(1, 0, 0);
    const up = new THREE.Vector3().crossVectors(right, forward);
    const centers = this.layout.clusters.map((_, index) => this.clusterCenter(index) ?? new THREE.Vector3());
    // The idle auto-rotate swings the camera all the way round, so the fit has to hold from
    // every side: full breathing room for the opening view, a tighter margin for the rest.
    const relative = this.scratch;
    const spin = new THREE.Matrix4();
    const fits = (distance: number): boolean => {
      for (let step = 0; step < FIT_AZIMUTHS; step++) {
        spin.makeRotationY((step / FIT_AZIMUTHS) * Math.PI * 2);
        const margin = step === 0 ? 1.4 : 0.85;
        for (let index = 0; index < centers.length; index++) {
          const reach = (this.layout.clusters[index]?.radius ?? 0) * margin;
          relative.copy(centers[index]!).applyMatrix4(spin).addScaledVector(toCamera, -distance);
          const depth = relative.dot(forward);
          if (depth <= reach) return false;
          if ((Math.abs(relative.dot(right)) + reach) / depth > horizontalReach) return false;
          if ((Math.abs(relative.dot(up)) + reach) / depth > verticalReach) return false;
        }
      }
      return true;
    };
    let near = 10;
    let far = 20000;
    for (let step = 0; step < 28; step++) {
      const middle = (near + far) / 2;
      if (fits(middle)) far = middle;
      else near = middle;
    }
    const distance = far * 1.03;

    this.homeTarget.set(0, 0, 0);
    this.homePosition.set(0, CAMERA_LIFT, 1).normalize().multiplyScalar(distance);
    this.controls.maxDistance = distance * 2.4;

    if (this.atHome) {
      this.fly = null;
      this.camera.position.copy(this.homePosition);
      this.controls.target.copy(this.homeTarget);
      this.controls.update();
    }
  }

  /**
   * Turn the arrangement of clusters around the view axis by `angle`, without turning
   * the clusters themselves: each mini galaxy keeps facing the same way, only where it
   * sits changes. Runs on resize only.
   */
  private arrangeClusters(angle: number): void {
    this.arrange.makeRotationZ(angle);
    const center = this.scratch;
    for (let i = 0; i < this.nodeCount; i++) {
      const cluster = this.layout.clusters[this.nodeCluster[i] ?? 0];
      if (!cluster) continue;
      center.fromArray(cluster.center).applyMatrix4(this.arrange);
      for (let axis = 0; axis < 3; axis++) {
        const offset = (this.layoutPositions[i * 3 + axis] ?? 0) - (cluster.center[axis] ?? 0);
        this.positions[i * 3 + axis] = center.getComponent(axis) + offset;
      }
    }
    this.nodes.geometry.getAttribute('position').needsUpdate = true;
    this.links.setPositions(this.positions);
    (this.particles.points.material.uniforms.uArrange!.value as THREE.Matrix3).setFromMatrix4(this.arrange);
  }

  /** Where the thing the camera is anchored to currently is. */
  private anchorPoint(): THREE.Vector3 | null {
    if (!this.anchor) return null;
    if (this.anchor.kind === 'cluster') return this.clusterCenter(this.anchor.index);
    return new THREE.Vector3().fromArray(this.positions, this.anchor.index * 3);
  }

  private clusterCenter(index: number): THREE.Vector3 | null {
    const cluster = this.layout.clusters[index];
    return cluster ? new THREE.Vector3(...cluster.center).applyMatrix4(this.arrange) : null;
  }

  // ---- what is on screen -----------------------------------------------------

  /** Set which nodes are visible. Links and particles follow automatically. */
  setVisible(mask: readonly boolean[], immediate = false): void {
    this.fade.setTargets(mask, immediate || this.options.reducedMotion);
    this.dirty = true;
  }

  /** Mark which nodes are due for review; they get a slow ring. */
  setDue(mask: readonly boolean[]): void {
    this.fade.setDue(mask);
    this.dirty = true;
  }

  /**
   * Put one node in focus: it and the nodes in `bright` keep full brightness, its links
   * light up, and everything else dims. Pass -1 to clear the focus.
   */
  setFocus(index: number, bright: readonly number[] = []): void {
    this.focus = index;
    this.nodes.material.uniforms.uFocus!.value = index;
    this.links.lines.material.uniforms.uFocus!.value = index;
    if (index < 0) {
      this.fade.setEmphasis(null, this.options.reducedMotion);
    } else {
      this.emphasisLevels.fill(DIM_LEVEL);
      this.emphasisLevels[index] = 1;
      for (const node of bright) this.emphasisLevels[node] = 1;
      this.fade.setEmphasis(this.emphasisLevels, this.options.reducedMotion);
    }
    if (this.options.reducedMotion) this.setFocusMix(index < 0 ? 0 : 1);
    this.dirty = true;
  }

  private setFocusMix(value: number): void {
    this.focusMix = value;
    this.links.lines.material.uniforms.uFocusMix!.value = value;
  }

  /** Ease the link highlight in or out with the focus. Returns true while it is changing. */
  private updateFocusMix(deltaSeconds: number): boolean {
    const goal = this.focus < 0 ? 0 : 1;
    if (this.focusMix === goal) return false;
    const step = deltaSeconds / 0.45;
    this.setFocusMix(goal > this.focusMix ? Math.min(goal, this.focusMix + step) : Math.max(goal, this.focusMix - step));
    return true;
  }

  setHover(index: number): void {
    if (this.nodes.material.uniforms.uHover!.value === index) return;
    this.nodes.material.uniforms.uHover!.value = index;
    this.links.lines.material.uniforms.uHover!.value = index;
    this.dirty = true;
  }

  /** Index of the visible node under a point (CSS pixels, relative to the canvas), or -1. */
  pick(x: number, y: number, touch: boolean): number {
    let best = -1;
    let bestDistance = Infinity;
    for (let i = 0; i < this.nodeCount; i++) {
      if (!this.fade.isOn(i)) continue;
      const point = this.screenPoint(i);
      if (!point.inView) continue;
      const distance = Math.hypot(point.x - x, point.y - y);
      const reach = Math.max(touch ? 24 : 12, point.radius);
      if (distance <= reach && distance < bestDistance) {
        best = i;
        bestDistance = distance;
      }
    }
    return best;
  }

  /** Where a node currently is on screen. */
  screenPoint(index: number): ScreenPoint {
    const v = this.scratch.fromArray(this.positions, index * 3).applyMatrix4(this.camera.matrixWorldInverse);
    const depth = -v.z;
    if (depth <= this.camera.near) return { x: 0, y: 0, radius: 0, inView: false };
    v.applyMatrix4(this.camera.projectionMatrix);
    const x = (v.x * 0.5 + 0.5) * this.width;
    const y = (1 - (v.y * 0.5 + 0.5)) * this.height;
    const pixelsPerUnit = this.height / (2 * Math.tan(THREE.MathUtils.degToRad(FOV) / 2)) / depth;
    const radius = (this.spriteSizes[index] ?? 6) * pixelsPerUnit * 0.3;
    const inView = x >= -20 && x <= this.width + 20 && y >= -20 && y <= this.height + 20;
    return { x, y, radius, inView };
  }

  // ---- camera moves ----------------------------------------------------------

  flyToCluster(index: number): void {
    const cluster = this.layout.clusters[index];
    const target = this.clusterCenter(index);
    if (!cluster || !target) return;

    const distance = Math.max(this.controls.minDistance * 2, (cluster.radius * 1.75) / this.viewReach());

    // Keep the current viewing angle; only the focus point and the distance change.
    const direction = this.camera.position.clone().sub(this.controls.target).normalize();

    this.atHome = false;
    this.anchor = { kind: 'cluster', index };
    this.startFly(target.clone().addScaledVector(direction, distance), target);
  }

  /**
   * Ease the camera to a node, close enough to see it with its nearer neighbours.
   * With `from` (another node), the camera travels along the link between the two and a
   * particle trail runs ahead of it.
   */
  flyToNode(index: number, neighbours: readonly number[] = [], from = -1): void {
    if (index < 0 || index >= this.nodeCount) return;
    const target = new THREE.Vector3().fromArray(this.positions, index * 3);

    // Frame the node together with most of its neighbours (a far-away one or two may stay off screen).
    const gaps = neighbours
      .map((node) => target.distanceTo(this.scratch.fromArray(this.positions, node * 3)))
      .sort((a, b) => a - b);
    const typical = gaps.length > 0 ? gaps[Math.floor((gaps.length - 1) * 0.75)]! : 20;
    const radius = THREE.MathUtils.clamp(typical, 20, 60);
    const distance = THREE.MathUtils.clamp((radius * 2.1) / this.viewReach(), 95, 420);
    const direction = this.camera.position.clone().sub(this.controls.target).normalize();

    let seconds = NODE_FLY_SECONDS;
    this.trail.stop();
    if (from >= 0 && from < this.nodeCount && from !== index) {
      const origin = new THREE.Vector3().fromArray(this.positions, from * 3);
      seconds = THREE.MathUtils.clamp(0.9 + origin.distanceTo(target) / 110, 1.1, 2.3);
      if (!this.options.reducedMotion) {
        this.trail.launch(
          origin,
          target,
          new THREE.Color().fromArray(this.nodeColors, from * 3),
          new THREE.Color().fromArray(this.nodeColors, index * 3),
          seconds,
        );
      }
    }

    this.atHome = false;
    this.anchor = { kind: 'node', index };
    this.startFly(target.clone().addScaledVector(direction, distance), target, seconds);
  }

  /** Tangent of the half-angle that fits inside the free area (the smaller of the two directions). */
  private viewReach(): number {
    const free = this.freeArea(this.viewInsets);
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(FOV) / 2);
    return Math.min(tanHalf * (free.height / this.height), tanHalf * this.camera.aspect * (free.width / this.width));
  }

  flyHome(): void {
    this.atHome = true;
    this.anchor = null;
    this.trail.stop();
    this.startFly(this.homePosition.clone(), this.homeTarget.clone());
  }

  private startFly(toPosition: THREE.Vector3, toTarget: THREE.Vector3, seconds = FLY_SECONDS): void {
    this.pauseAutoRotate();
    if (this.options.reducedMotion) {
      // No camera travel for reduced motion: cut straight to the new view.
      this.fly = null;
      this.camera.position.copy(toPosition);
      this.controls.target.copy(toTarget);
      this.controls.update();
      this.dirty = true;
      return;
    }
    this.fly = {
      fromPosition: this.camera.position.clone(),
      fromTarget: this.controls.target.clone(),
      toPosition,
      toTarget,
      progress: 0,
      seconds,
    };
  }

  private updateFly(deltaSeconds: number): boolean {
    const fly = this.fly;
    if (!fly) return false;
    fly.progress = Math.min(1, fly.progress + deltaSeconds / fly.seconds);
    const p = fly.progress;
    const eased = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
    this.camera.position.lerpVectors(fly.fromPosition, fly.toPosition, eased);
    this.controls.target.lerpVectors(fly.fromTarget, fly.toTarget, eased);
    if (p >= 1) this.fly = null;
    return true;
  }

  // ---- idle auto-rotate ------------------------------------------------------

  private pauseAutoRotate(): void {
    this.controls.autoRotate = false;
    this.rotateSpeed = 0;
    window.clearTimeout(this.idleTimer);
    if (this.options.reducedMotion) return;
    this.idleTimer = window.setTimeout(() => {
      this.controls.autoRotate = true;
    }, IDLE_RESUME_MS);
  }

  private readonly handleInteractionStart = (): void => {
    this.fly = null;
    this.atHome = false;
    this.controls.autoRotate = false;
    this.rotateSpeed = 0;
    window.clearTimeout(this.idleTimer);
    this.onInteract?.();
  };

  private readonly handleInteractionEnd = (): void => {
    this.pauseAutoRotate();
  };

  // ---- render loop -----------------------------------------------------------

  private readonly markDirty = (): void => {
    this.dirty = true;
  };

  private readonly handleContextLost = (event: Event): void => {
    event.preventDefault();
  };

  private readonly handleVisibility = (): void => {
    if (document.hidden) this.stop();
    else this.start();
  };

  private readonly tick = (now: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.tick);

    const deltaMs = this.lastFrame === 0 ? 1000 / 60 : now - this.lastFrame;
    this.lastFrame = now;
    // Long gaps are capped so nothing leaps after a stall, but slow devices still keep real time.
    const delta = Math.min(deltaMs, 250) / 1000;

    if (this.perf.frame(deltaMs)) this.applyTier();
    this.onFrame?.(delta);

    const moving = !this.options.reducedMotion;
    if (moving) {
      this.time += delta;
      // Ease the auto-rotation in so it never starts with a jerk.
      if (this.controls.autoRotate) {
        this.rotateSpeed = Math.min(AUTO_ROTATE_SPEED, this.rotateSpeed + delta * (AUTO_ROTATE_SPEED / 2.5));
      }
      this.controls.autoRotateSpeed = this.rotateSpeed;
    }

    // OrbitControls damps per frame; scale it by frame time so the glide after a drag
    // lasts equally long at 30fps and 120fps.
    this.controls.dampingFactor = 1 - Math.pow(1 - DAMPING_PER_FRAME, Math.min(delta * 60, 12));

    let dirty = this.dirty || moving;
    if (this.updateFly(delta)) dirty = true;
    if (this.updateViewShift(delta)) dirty = true;
    if (this.updateFocusMix(delta)) dirty = true;
    if (this.trail.update(delta)) dirty = true;
    if (this.controls.update(delta)) dirty = true;
    if (this.fade.update(delta)) dirty = true;
    if (!dirty) return;
    this.dirty = false;

    this.nodes.material.uniforms.uTime!.value = this.time;
    this.particles.points.material.uniforms.uTime!.value = this.time;
    this.stars.material.uniforms.uTime!.value = this.time;

    // Parallax: the star shell follows the camera almost, but not quite, all the way.
    this.stars.position.copy(this.camera.position).multiplyScalar(STAR_PARALLAX);
    this.stars.rotation.y = this.time * 0.0035;
    this.stars.rotation.x = this.time * 0.0012;

    // Bloom breathes very slightly when motion is allowed; it is constant otherwise.
    this.bloom.strength = BLOOM_STRENGTH * (1 + (moving ? 0.05 * Math.sin(this.time * 0.45) : 0));

    this.composer.render(delta);
    this.onAfterRender?.();
  };

  // ---- debug -----------------------------------------------------------------

  stats(): RenderStats {
    return {
      fps: this.perf.fps,
      frameMs: this.perf.frameMs,
      tier: this.perf.tier,
      particles: this.particlesDrawn,
      particlesTotal: this.particles.total,
      pixelRatio: this.pixelRatio,
      width: this.width,
      height: this.height,
      nodesOn: this.fade.onCount(),
      nodesDrawn: this.fade.drawnCount(),
      autoRotating: this.controls.autoRotate && this.rotateSpeed > 0,
      camera: this.camera.position.toArray(),
      focus: this.focus,
      nodesDimmed: this.fade.dimmedCount(),
      nodesDue: this.fade.dueCount(),
      flying: this.fly !== null,
      trailActive: this.trail.points.visible,
    };
  }
}
