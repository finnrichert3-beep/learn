import type { RenderStats } from '../render/renderer';
import { el } from './dom';

export interface DebugPanel {
  element: HTMLElement;
  set(stats: RenderStats): void;
}

/** FPS readout, only created when the page is opened with ?debug. */
export function createDebugPanel(): DebugPanel {
  const element = el('aside', 'glass debug', undefined, { 'aria-label': 'Performance' });
  const fps = el('div', 'debug-fps', '-- fps');
  const detail = el('div', 'debug-detail');
  element.append(fps, detail);
  return {
    element,
    set(stats) {
      fps.textContent = stats.fps > 0 ? `${stats.fps.toFixed(0)} fps` : '-- fps';
      fps.classList.toggle('is-slow', stats.fps > 0 && stats.fps < 30);
      detail.textContent = [
        `${stats.frameMs.toFixed(1)} ms/frame`,
        `${stats.particles.toLocaleString('en-US')} of ${stats.particlesTotal.toLocaleString('en-US')} particles`,
        `quality ${stats.tier + 1}/5 · ${stats.pixelRatio.toFixed(2)}x`,
        `${stats.width}×${stats.height}`,
      ].join('\n');
    },
  };
}
