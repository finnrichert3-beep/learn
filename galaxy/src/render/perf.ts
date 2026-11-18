/** Quality levels, best first. The renderer steps down one level each time FPS stays under the floor. */
export interface QualityTier {
  /** Fraction of the particles that are drawn. */
  particleFraction: number;
  /** Upper bound for the device pixel ratio. */
  maxPixelRatio: number;
}

export const QUALITY_TIERS: readonly QualityTier[] = [
  { particleFraction: 1, maxPixelRatio: 2 },
  { particleFraction: 0.7, maxPixelRatio: 2 },
  { particleFraction: 0.5, maxPixelRatio: 1.5 },
  { particleFraction: 0.35, maxPixelRatio: 1.25 },
  { particleFraction: 0.25, maxPixelRatio: 1 },
];

export interface PerfOptions {
  /** Step down when the measured FPS is below this. */
  minFps: number;
  /** Length of one measuring window. */
  windowMs: number;
  /** Consecutive slow windows needed before stepping down. */
  slowWindows: number;
  /** Time ignored at start-up and after each change, while things settle. */
  settleMs: number;
}

const DEFAULTS: PerfOptions = { minFps: 30, windowMs: 1000, slowWindows: 2, settleMs: 1500 };

/**
 * Measures FPS in fixed windows and decides when quality has to drop.
 * Pure bookkeeping: feed it frame durations, it tells you the tier.
 */
export class PerfMonitor {
  /** FPS of the last completed window (0 until the first one finishes). */
  fps = 0;
  /** Average frame time of the last completed window, in ms. */
  frameMs = 0;
  tier = 0;
  private readonly options: PerfOptions;
  private frames = 0;
  private elapsed = 0;
  private settle: number;
  private slow = 0;

  constructor(
    private readonly tierCount: number,
    options: Partial<PerfOptions> = {},
    private readonly locked = false,
  ) {
    this.options = { ...DEFAULTS, ...options };
    this.settle = this.options.settleMs;
  }

  /** Record one frame. Returns true when the tier just changed. */
  frame(deltaMs: number): boolean {
    // A huge gap means the tab was hidden or the page stalled: not a rendering problem.
    if (deltaMs > 500) {
      this.reset();
      return false;
    }
    this.frames++;
    this.elapsed += deltaMs;
    if (this.elapsed < this.options.windowMs) return false;

    this.fps = (this.frames * 1000) / this.elapsed;
    this.frameMs = this.elapsed / this.frames;
    const windowLength = this.elapsed;
    this.frames = 0;
    this.elapsed = 0;

    if (this.settle > 0) {
      this.settle -= windowLength;
      return false;
    }
    if (this.fps >= this.options.minFps) {
      this.slow = 0;
      return false;
    }
    this.slow++;
    if (this.slow < this.options.slowWindows || this.locked || this.tier >= this.tierCount - 1) return false;

    this.tier++;
    this.slow = 0;
    this.settle = this.options.settleMs;
    return true;
  }

  /** Forget the current window, e.g. after the tab was hidden. */
  reset(): void {
    this.frames = 0;
    this.elapsed = 0;
    this.slow = 0;
    this.settle = Math.max(this.settle, this.options.windowMs);
  }
}
