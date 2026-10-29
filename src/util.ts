import type { TimeWindow } from './model.js';

export function ts(value: string | null | undefined): number {
  return value ? Date.parse(value) : NaN;
}

export function inWindow(value: string | null | undefined, window: TimeWindow): boolean {
  const t = ts(value);
  return !Number.isNaN(t) && t >= ts(window.since) && t < ts(window.until);
}

/** Make a single-line, readable excerpt from a GitHub Markdown body. */
export function excerpt(body: string | null | undefined, max = 400): string {
  if (!body) return '';
  let text = body
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<img\b[^>]*>/gi, '[image]')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '[image]')
    .replace(/\[([^\]]+)\]\((?:[^()\s]|\([^)]*\))+\)/g, '$1')
    .replace(/<\/?[a-z][^>]*>/gi, ' ')
    .replace(/^[ \t]*#{1,6}\s+/gm, '')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/\r/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length > max) text = text.slice(0, max - 1).trimEnd() + '…';
  return text;
}

/** Extract @mentions, ignoring fenced code, inline code, quoted lines and e-mail addresses. */
export function mentions(body: string | null | undefined): string[] {
  if (!body) return [];
  const text = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('>'))
    .join('\n');
  const found = new Set<string>();
  const re = /(^|[^\w@/.-])@([A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38})(?![\w/])/g;
  for (const m of text.matchAll(re)) found.add(m[2]);
  return [...found];
}

export function firstLine(message: string): string {
  return message.split('\n', 1)[0].trim();
}

export function htmlEscape(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

export function day(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : '';
}

export function uniq<T>(values: Iterable<T>): T[] {
  return [...new Set(values)];
}

export function byTime<T>(get: (item: T) => string | null | undefined) {
  return (a: T, b: T) => ts(get(a)) - ts(get(b));
}
