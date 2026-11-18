import { JsonSyntaxError, parseJson } from './json';
import type { Cluster, GalaxyData, GalaxyNode, Link, ValidationIssue } from './types';

export type ValidationResult =
  | { ok: true; data: GalaxyData }
  | { ok: false; issues: ValidationIssue[] };

type LineOf = (path: string) => number | undefined;

const CLUSTER_FIELDS = ['id', 'name', 'color', 'group'];
const NODE_FIELDS = ['id', 'label', 'cluster', 'date', 'size'];
const ROOT_FIELDS = ['clusters', 'nodes', 'links'];
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parse and validate the raw text of galaxy.json. Never throws. */
export function validateGalaxyText(text: string): ValidationResult {
  let parsed;
  try {
    parsed = parseJson(text);
  } catch (error) {
    if (error instanceof JsonSyntaxError) {
      return {
        ok: false,
        issues: [{ path: '', message: error.message, line: error.line, column: error.column }],
      };
    }
    return { ok: false, issues: [{ path: '', message: `Could not read the file: ${String(error)}` }] };
  }
  return validateGalaxy(parsed.value, parsed.lineOf);
}

/** Validate an already-parsed value. `lineOf` adds line numbers to the issues when available. */
export function validateGalaxy(value: unknown, lineOf: LineOf = () => undefined): ValidationResult {
  const issues: ValidationIssue[] = [];
  const report = (path: string, message: string, linePath: string = path): void => {
    // Fall back to the nearest parent that exists, so a missing field still gets a line.
    let line: number | undefined;
    let probe = linePath;
    for (;;) {
      line = lineOf(probe);
      if (line !== undefined || probe === '') break;
      probe = parentPath(probe);
    }
    issues.push(line === undefined ? { path, message } : { path, message, line });
  };

  if (!isRecord(value)) {
    report('', `The file must be an object like { "clusters": [...], "nodes": [...], "links": [...] }, but it is ${typeName(value)}.`);
    return { ok: false, issues };
  }

  checkUnknownFields(value, ROOT_FIELDS, '', report);

  // ---- clusters -----------------------------------------------------------
  const clusters: Cluster[] = [];
  const clusterIds = new Set<string>();
  if (!Array.isArray(value.clusters)) {
    report('clusters', value.clusters === undefined ? 'Missing. Add a "clusters" list.' : `Must be a list [...], but it is ${typeName(value.clusters)}.`);
  } else {
    if (value.clusters.length === 0) report('clusters', 'Add at least one cluster.');
    value.clusters.forEach((raw: unknown, index: number) => {
      const path = `clusters[${index}]`;
      if (!isRecord(raw)) {
        report(path, `Must be an object like { "id": "...", "name": "...", "color": "#4d8dff" }, but it is ${typeName(raw)}.`);
        return;
      }
      checkUnknownFields(raw, CLUSTER_FIELDS, path, report);
      const id = requireString(raw, 'id', path, report);
      const name = requireString(raw, 'name', path, report);
      const color = requireString(raw, 'color', path, report);
      let group = '';
      if (raw.group !== undefined) {
        if (typeof raw.group !== 'string') report(`${path}.group`, `Must be text, but it is ${typeName(raw.group)}.`);
        else group = raw.group.trim();
      }
      if (color !== undefined && !HEX_COLOR.test(color)) {
        report(`${path}.color`, `"${color}" is not a hex color. Use something like "#4d8dff".`);
      }
      if (id !== undefined) {
        if (clusterIds.has(id)) report(`${path}.id`, `Duplicate cluster id "${id}". Every cluster needs its own id.`);
        clusterIds.add(id);
      }
      if (id !== undefined && name !== undefined && color !== undefined) {
        clusters.push({ id, name, color, group });
      }
    });
  }

  // ---- nodes --------------------------------------------------------------
  const nodes: GalaxyNode[] = [];
  const nodeIds = new Set<string>();
  if (!Array.isArray(value.nodes)) {
    report('nodes', value.nodes === undefined ? 'Missing. Add a "nodes" list.' : `Must be a list [...], but it is ${typeName(value.nodes)}.`);
  } else {
    if (value.nodes.length === 0) report('nodes', 'Add at least one node.');
    value.nodes.forEach((raw: unknown, index: number) => {
      const path = `nodes[${index}]`;
      if (!isRecord(raw)) {
        report(path, `Must be an object like { "id": "...", "label": "...", "cluster": "...", "date": "2026-09-01" }, but it is ${typeName(raw)}.`);
        return;
      }
      checkUnknownFields(raw, NODE_FIELDS, path, report);
      const id = requireString(raw, 'id', path, report);
      const label = requireString(raw, 'label', path, report);
      const cluster = requireString(raw, 'cluster', path, report);
      const date = requireString(raw, 'date', path, report);

      if (id !== undefined) {
        if (nodeIds.has(id)) report(`${path}.id`, `Duplicate node id "${id}". Every node needs its own id.`);
        nodeIds.add(id);
      }
      if (cluster !== undefined && Array.isArray(value.clusters) && !clusterIds.has(cluster)) {
        report(`${path}.cluster`, `Unknown cluster "${cluster}". ${suggest(cluster, clusterIds, 'cluster ids')}`);
      }
      if (date !== undefined) {
        const problem = dateProblem(date);
        if (problem) report(`${path}.date`, problem);
      }
      let size: number | undefined;
      if (raw.size !== undefined) {
        if (typeof raw.size !== 'number' || !Number.isFinite(raw.size)) {
          report(`${path}.size`, `Must be a number from 1 to 5, but it is ${typeName(raw.size)}.`);
        } else if (raw.size < 1 || raw.size > 5) {
          report(`${path}.size`, `Must be between 1 and 5, but it is ${raw.size}.`);
        } else {
          size = raw.size;
        }
      }
      if (id !== undefined && label !== undefined && cluster !== undefined && date !== undefined) {
        nodes.push(size === undefined ? { id, label, cluster, date } : { id, label, cluster, date, size });
      }
    });
  }

  // ---- links --------------------------------------------------------------
  const links: Link[] = [];
  const seenPairs = new Set<string>();
  if (value.links !== undefined && !Array.isArray(value.links)) {
    report('links', `Must be a list of pairs like [["idA", "idB"]], but it is ${typeName(value.links)}.`);
  } else if (Array.isArray(value.links)) {
    value.links.forEach((raw: unknown, index: number) => {
      const path = `links[${index}]`;
      if (!Array.isArray(raw) || raw.length !== 2) {
        report(path, 'A link must be a pair of two node ids, like ["idA", "idB"].');
        return;
      }
      let valid = true;
      raw.forEach((end: unknown, endIndex: number) => {
        const endPath = `${path}[${endIndex}]`;
        if (typeof end !== 'string') {
          report(endPath, `Must be a node id in double quotes, but it is ${typeName(end)}.`);
          valid = false;
        } else if (Array.isArray(value.nodes) && !nodeIds.has(end)) {
          report(endPath, `Unknown node "${end}". ${suggest(end, nodeIds, 'node ids')}`);
          valid = false;
        }
      });
      if (!valid) return;
      const [a, b] = raw as [string, string];
      if (a === b) {
        report(path, `A node can't link to itself ("${a}").`);
        return;
      }
      // The same pair written twice (in either order) counts once.
      const key = a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
      if (seenPairs.has(key)) return;
      seenPairs.add(key);
      links.push([a, b]);
    });
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, data: { clusters, nodes, links } };
}

/** Returns a message when `date` is not a real YYYY-MM-DD calendar date. */
export function dateProblem(date: string): string | undefined {
  const match = ISO_DATE.exec(date);
  if (!match) return `"${date}" is not a date. Use YYYY-MM-DD, like "2026-09-14".`;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) {
    return `"${date}" is not a real calendar date.`;
  }
  return undefined;
}

function requireString(
  record: Record<string, unknown>,
  field: string,
  path: string,
  report: (path: string, message: string) => void,
): string | undefined {
  const raw = record[field];
  if (raw === undefined) {
    report(`${path}.${field}`, `Missing. Every item here needs "${field}".`);
    return undefined;
  }
  if (typeof raw !== 'string') {
    report(`${path}.${field}`, `Must be text in double quotes, but it is ${typeName(raw)}.`);
    return undefined;
  }
  if (raw.trim() === '') {
    report(`${path}.${field}`, "Can't be empty.");
    return undefined;
  }
  return raw;
}

function checkUnknownFields(
  record: Record<string, unknown>,
  allowed: string[],
  path: string,
  report: (path: string, message: string) => void,
): void {
  for (const key of Object.keys(record)) {
    if (allowed.includes(key)) continue;
    const near = closest(key, allowed);
    const hint = near ? ` Did you mean "${near}"?` : ` Allowed: ${allowed.join(', ')}.`;
    report(path === '' ? key : `${path}.${key}`, `Unknown field "${key}".${hint}`);
  }
}

function suggest(value: string, known: Set<string>, what: string): string {
  const near = closest(value, [...known]);
  if (near) return `Did you mean "${near}"?`;
  return `It has to match one of the ${what}.`;
}

/** Closest candidate within a small edit distance, for "did you mean" hints. */
function closest(value: string, candidates: string[]): string | undefined {
  let best: string | undefined;
  let bestDistance = Math.max(2, Math.floor(value.length / 3)) + 1;
  for (const candidate of candidates) {
    const distance = editDistance(value.toLowerCase(), candidate.toLowerCase());
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, (previous[j - 1] ?? 0) + cost);
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

function parentPath(path: string): string {
  const cut = Math.max(path.lastIndexOf('.'), path.lastIndexOf('['));
  return cut <= 0 ? '' : path.slice(0, cut);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function typeName(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'a list';
  if (typeof value === 'string') return 'text';
  if (typeof value === 'object') return 'an object';
  if (typeof value === 'undefined') return 'missing';
  return `a ${typeof value}`;
}
