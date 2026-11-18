// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { boot } from '../src/boot';
import { loadGalaxy } from '../src/data/load';

const seedText = readFileSync(resolve(process.cwd(), 'public/galaxy.json'), 'utf8');

const respond = (body: string, status = 200) => () => Promise.resolve(new Response(body, { status }));

let root: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  root = document.getElementById('app') as HTMLElement;
});

describe('a broken galaxy.json shows an error instead of crashing', () => {
  it('syntax error: says which line', async () => {
    // Drop the comma at the end of the first cluster line.
    const lines = seedText.split('\n');
    const index = lines.findIndex((line) => line.includes('"id": "calc"'));
    lines[index] = (lines[index] ?? '').replace(/,\s*$/, '');
    const outcome = await boot(root, { fetch: respond(lines.join('\n')) });

    expect(outcome).toBe('error');
    const card = root.querySelector('.error-card');
    expect(card).not.toBeNull();
    expect(card?.getAttribute('role')).toBe('alert');
    expect(root.querySelector('.error-title')?.textContent).toBe('galaxy.json has a problem');
    expect(root.querySelector('.error-line')?.textContent).toBe(`Line ${index + 1}, column ${(lines[index] ?? '').length + 1}`);
    expect(root.querySelector('.error-message')?.textContent).toMatch(/Missing comma/);
    expect(root.querySelector('canvas')).toBeNull();
  });

  it('bad field: says which field and which line', async () => {
    const broken = seedText.replace('"date": "2026-09-11"', '"date": "2026-09-31"');
    const line = broken.split('\n').findIndex((text) => text.includes('2026-09-31')) + 1;
    await boot(root, { fetch: respond(broken) });

    expect(root.querySelector('.error-line')?.textContent).toBe(`Line ${line}`);
    expect(root.querySelector('.error-path')?.textContent).toBe('nodes[2].date');
    expect(root.querySelector('.error-message')?.textContent).toContain('not a real calendar date');
  });

  it('lists several problems and caps the list', async () => {
    const broken = seedText.replaceAll('"cluster": "calc"', '"cluster": "calculus"');
    await boot(root, { fetch: respond(broken) });

    expect(root.querySelectorAll('.error-item')).toHaveLength(6);
    expect(root.querySelector('.error-more')?.textContent).toContain('4 more problems');
  });

  it.each([
    ['an empty file', '', /empty/],
    ['a truncated file', seedText.slice(0, 400), /never closed|ends too early|closing double quote/],
    ['plain text', 'hello', /double quotes/],
    ['a web page', '<!doctype html><html></html>', /web page instead of JSON/],
  ])('%s', async (_name, body, pattern) => {
    const outcome = await boot(root, { fetch: respond(body) });
    expect(outcome).toBe('error');
    expect(root.querySelector('.error-message')?.textContent).toMatch(pattern);
  });

  it('missing file (404)', async () => {
    await boot(root, { fetch: respond('Not found', 404) });
    expect(root.querySelector('.error-title')?.textContent).toBe("Couldn't load galaxy.json");
    expect(root.querySelector('.error-message')?.textContent).toContain('public/galaxy.json');
  });

  it('network failure', async () => {
    const outcome = await boot(root, { fetch: () => Promise.reject(new TypeError('Failed to fetch')) });
    expect(outcome).toBe('error');
    expect(root.querySelector('.error-message')?.textContent).toContain('could not be downloaded');
  });

  it('never injects file contents as HTML', async () => {
    const broken = seedText.replace('"cluster": "calc"', '"cluster": "<img src=x onerror=alert(1)>"');
    await boot(root, { fetch: respond(broken) });
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('.error-message')?.textContent).toContain('<img src=x');
  });
});

describe('a valid galaxy.json on a device without WebGL', () => {
  it('shows a readable message instead of a blank page', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const outcome = await boot(root, { fetch: respond(seedText) });
    quiet.mockRestore();

    // happy-dom has no WebGL, exactly like an unsupported browser.
    expect(outcome).toBe('error');
    expect(root.querySelector('.error-title')?.textContent).toBe("Couldn't start the 3D view");
    expect(root.querySelector('.error-hint')?.textContent).toContain('WebGL');
  });
});

describe('loadGalaxy', () => {
  it('returns the data for a valid file', async () => {
    const result = await loadGalaxy('galaxy.json', respond(seedText));
    expect(result.ok && result.data.nodes.length).toBe(105);
  });
});
