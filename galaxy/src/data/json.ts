/**
 * A small JSON parser that remembers where every value came from.
 *
 * JSON.parse only reports "position 1234" (and nothing at all in some browsers),
 * which is useless when you edit the file by hand. This parser gives a line and
 * column for syntax errors, and lets the validator say which line a bad field is on.
 */

export class JsonSyntaxError extends Error {
  readonly line: number;
  readonly column: number;

  constructor(message: string, line: number, column: number) {
    super(message);
    this.name = 'JsonSyntaxError';
    this.line = line;
    this.column = column;
  }
}

export interface ParsedJson {
  value: unknown;
  /** 1-based line where the value at `path` starts, e.g. lineOf("nodes[3].date"). */
  lineOf(path: string): number | undefined;
}

const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const ESCAPES: Record<string, string> = {
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
};

export function parseJson(source: string): ParsedJson {
  const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const offsets = new Map<string, number>();
  let i = 0;
  /** Offset just past the last complete value, used to point at missing commas. */
  let lastEnd = 0;

  const lineStarts: number[] = [0];
  for (let k = 0; k < text.length; k++) {
    if (text.charCodeAt(k) === 10) lineStarts.push(k + 1);
  }

  function locate(offset: number): { line: number; column: number } {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((lineStarts[mid] ?? 0) <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, column: offset - (lineStarts[lo] ?? 0) + 1 };
  }

  function fail(message: string, offset = i): never {
    const { line, column } = locate(Math.min(offset, text.length));
    throw new JsonSyntaxError(message, line, column);
  }

  function skipWhitespace(): void {
    while (i < text.length) {
      const c = text.charCodeAt(i);
      if (c === 32 || c === 9 || c === 10 || c === 13) i++;
      else break;
    }
  }

  function describe(ch: string | undefined): string {
    if (ch === undefined) return 'the end of the file';
    return `"${ch}"`;
  }

  function parseValue(path: string): unknown {
    skipWhitespace();
    offsets.set(path, i);
    const ch = text[i];
    let value: unknown;
    if (ch === '{') value = parseObject(path);
    else if (ch === '[') value = parseArray(path);
    else if (ch === '"') value = parseString();
    else if (ch === '-' || (ch !== undefined && ch >= '0' && ch <= '9')) value = parseNumber();
    else if (text.startsWith('true', i)) (i += 4), (value = true);
    else if (text.startsWith('false', i)) (i += 5), (value = false);
    else if (text.startsWith('null', i)) (i += 4), (value = null);
    else if (ch === undefined) fail('The file ends too early. A value, bracket or brace is missing.');
    else if (ch === "'") fail('Use double quotes ("like this"), not single quotes.');
    else if (ch === '/') fail("Comments aren't allowed in JSON. Remove this comment.");
    else if (ch === ',') fail('Extra comma. Remove it, or add the item that is missing before it.');
    else if (ch === ']' || ch === '}') fail(`Unexpected ${describe(ch)}. Is there a trailing comma just before it?`);
    else if (/[A-Za-z_]/.test(ch)) fail('Text has to be wrapped in double quotes ("like this").');
    else fail(`Unexpected character ${describe(ch)}.`);
    lastEnd = i;
    return value;
  }

  function parseObject(path: string): Record<string, unknown> {
    const open = i;
    i++; // {
    const result: Record<string, unknown> = {};
    skipWhitespace();
    if (text[i] === '}') {
      i++;
      return result;
    }
    for (;;) {
      skipWhitespace();
      const ch = text[i];
      if (ch !== '"') {
        if (ch === '}') fail('Trailing comma before "}". Remove the last comma.', lastEnd);
        if (ch === undefined) fail('This "{" is never closed with a "}".', open);
        if (ch === "'") fail('Property names need double quotes ("like this"), not single quotes.');
        fail(`Expected a property name in double quotes, found ${describe(ch)}.`);
      }
      const key = parseString();
      skipWhitespace();
      if (text[i] === undefined) fail('The file ends too early. This "{" is never closed with a "}".', open);
      if (text[i] !== ':') fail(`Expected ":" after the property name "${key}".`);
      i++;
      result[key] = parseValue(path === '' ? key : `${path}.${key}`);
      skipWhitespace();
      const next = text[i];
      if (next === ',') {
        i++;
        continue;
      }
      if (next === '}') {
        i++;
        return result;
      }
      if (next === undefined) fail('This "{" is never closed with a "}".', open);
      if (next === '"') fail('Missing comma after this item.', lastEnd);
      fail(`Expected "," or "}" here, found ${describe(next)}.`);
    }
  }

  function parseArray(path: string): unknown[] {
    const open = i;
    i++; // [
    const result: unknown[] = [];
    skipWhitespace();
    if (text[i] === ']') {
      i++;
      return result;
    }
    for (;;) {
      skipWhitespace();
      if (text[i] === ']') fail('Trailing comma before "]". Remove the last comma.', lastEnd);
      if (text[i] === undefined) fail('This "[" is never closed with a "]".', open);
      result.push(parseValue(`${path}[${result.length}]`));
      skipWhitespace();
      const next = text[i];
      if (next === ',') {
        i++;
        continue;
      }
      if (next === ']') {
        i++;
        return result;
      }
      if (next === undefined) fail('This "[" is never closed with a "]".', open);
      if (next === '{' || next === '[' || next === '"') fail('Missing comma after this item.', lastEnd);
      fail(`Expected "," or "]" here, found ${describe(next)}.`);
    }
  }

  function parseString(): string {
    const open = i;
    i++; // opening quote
    let out = '';
    for (;;) {
      const ch = text[i];
      if (ch === undefined || ch === '\n' || ch === '\r') {
        fail('This text is missing its closing double quote.', open);
      }
      if (ch === '"') {
        i++;
        return out;
      }
      if (ch === '\\') {
        const esc = text[i + 1];
        if (esc === 'u') {
          const hex = text.slice(i + 2, i + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('Invalid \\u escape. It needs four hex digits.');
          out += String.fromCharCode(parseInt(hex, 16));
          i += 6;
        } else if (esc !== undefined && esc in ESCAPES) {
          out += ESCAPES[esc];
          i += 2;
        } else {
          fail(`Invalid escape "\\${esc ?? ''}". To write a backslash, use "\\\\".`);
        }
        continue;
      }
      if (ch.charCodeAt(0) < 0x20) fail('Tabs and control characters are not allowed inside text.');
      out += ch;
      i++;
    }
  }

  function parseNumber(): number {
    NUMBER.lastIndex = i;
    const match = NUMBER.exec(text);
    if (!match || match[0] === '-') fail('Invalid number.');
    const end = i + match[0].length;
    const after = text[end];
    if (after !== undefined && /[0-9A-Za-z_.+]/.test(after)) {
      fail('Invalid number. Numbers look like 3 or 2.5 (no leading zeros, no units).');
    }
    i = end;
    return Number(match[0]);
  }

  if (text.trim() === '') fail('The file is empty.', 0);
  const value = parseValue('');
  skipWhitespace();
  if (i < text.length) {
    fail(`Unexpected ${describe(text[i])} after the end of the data. Is there an extra bracket or brace?`);
  }

  return {
    value,
    lineOf(path: string): number | undefined {
      const offset = offsets.get(path);
      return offset === undefined ? undefined : locate(offset).line;
    },
  };
}
