import { loadGalaxy } from './data/load';
import { renderError } from './ui/errorScreen';

export interface BootOptions {
  /** Override for tests. */
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  url?: string;
}

/**
 * Load galaxy.json, then start the 3D app. Any failure (missing file, broken JSON,
 * invalid data, no WebGL) ends in a readable error card inside `root`, never a blank page.
 */
export async function boot(root: HTMLElement, options: BootOptions = {}): Promise<'started' | 'error'> {
  const url = options.url ?? `${import.meta.env.BASE_URL}galaxy.json`;
  const result = await loadGalaxy(url, options.fetch ?? ((input, init) => fetch(input, init)));
  if (!result.ok) {
    renderError(root, result.title, result.issues, result.hint);
    return 'error';
  }

  try {
    // The 3D code is only loaded once the data is known to be good.
    const { startApp } = await import('./app');
    startApp(root, result.data);
    return 'started';
  } catch (error) {
    console.error(error);
    renderError(
      root,
      "Couldn't start the 3D view",
      [{ path: '', message: error instanceof Error ? error.message : String(error) }],
      'Galaxy needs WebGL. Try a current version of Chrome, Safari, Firefox or Edge, and make sure hardware acceleration is on.',
    );
    return 'error';
  }
}
