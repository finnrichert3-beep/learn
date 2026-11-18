import type { GalaxyData, ValidationIssue } from './types';
import { validateGalaxyText } from './validate';

export type LoadResult =
  | { ok: true; data: GalaxyData }
  | { ok: false; title: string; issues: ValidationIssue[]; hint?: string };

const MISSING_HINT = 'Once the file is in place, reload this page.';

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Fetch and validate galaxy.json. Never throws; every failure comes back as a readable result. */
export async function loadGalaxy(url: string, fetchImpl: FetchLike = fetch): Promise<LoadResult> {
  let text: string;
  try {
    const response = await fetchImpl(url, { cache: 'no-cache' });
    if (!response.ok) {
      const message =
        response.status === 404
          ? 'The file was not found. It should be at public/galaxy.json.'
          : `The server answered with an error (${response.status}).`;
      return { ok: false, title: "Couldn't load galaxy.json", issues: [{ path: '', message }], hint: MISSING_HINT };
    }
    text = await response.text();
  } catch {
    return {
      ok: false,
      title: "Couldn't load galaxy.json",
      issues: [{ path: '', message: 'The file could not be downloaded. Check your connection and reload.' }],
      hint: MISSING_HINT,
    };
  }

  if (/^\s*</.test(text)) {
    return {
      ok: false,
      title: "Couldn't load galaxy.json",
      issues: [{ path: '', message: 'Got a web page instead of JSON. Make sure the file is at public/galaxy.json.' }],
      hint: MISSING_HINT,
    };
  }

  const result = validateGalaxyText(text);
  if (result.ok) return result;
  return { ok: false, title: 'galaxy.json has a problem', issues: result.issues };
}
