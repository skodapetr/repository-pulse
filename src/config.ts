import type { TimeWindow } from './model.js';

export interface Config {
  repositories: string[];
  components: string[];
  window: TimeWindow;
  outputDirectory: string;
  token?: string;
  apiUrl?: string;
  ignoreUsers: string[];
  title: string;
  /** How many reports to keep, see history.ts. -1 means no limit. */
  retention: { days: number; count: number };
  viewer: ViewerSetting;
  /** Published site to download earlier reports from before running. */
  restoreUrl?: string;
}

/** Where index.html gets its viewer from. */
export type ViewerSetting =
  | { kind: 'default' }
  | { kind: 'none' }
  | { kind: 'file'; path: string }
  | { kind: 'url'; url: string };

/** Raw string inputs, as they come from action inputs or CLI flags. */
export interface RawInputs {
  repositories?: string;
  components?: string;
  days?: string;
  since?: string;
  until?: string;
  'output-directory'?: string;
  token?: string;
  'api-url'?: string;
  'ignore-users'?: string;
  title?: string;
  'history-days'?: string;
  'history-count'?: string;
  viewer?: string;
  'restore-url'?: string;
}

export const DEFAULT_COMPONENTS = ['json', 'agent'];

/** Split a list given as lines, commas or a YAML-style "- item" list. Lines starting with # are comments. */
export function parseList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[\n,]/)
    .map((item) => item.replace(/#.*$/, '').replace(/^\s*-\s+/, '').trim())
    .filter(Boolean);
}

export function parseRepository(value: string): string {
  const cleaned = value
    .trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/, '')
    .replace(/\/+$/, '');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(cleaned)) {
    throw new Error(`Invalid repository "${value}". Use owner/name.`);
  }
  return cleaned;
}

function parseInstant(value: string, name: string): Date {
  const trimmed = value.trim();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? new Date(`${trimmed}T00:00:00Z`) : new Date(trimmed);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid ${name} "${value}". Use YYYY-MM-DD or an ISO 8601 timestamp.`);
  return date;
}

function iso(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function parseWindow(raw: { days?: string; since?: string; until?: string }, now = new Date()): TimeWindow {
  const until = raw.until?.trim() ? parseInstant(raw.until, 'until') : new Date(Math.floor(now.getTime() / 1000) * 1000);
  let since: Date;
  if (raw.since?.trim()) {
    since = parseInstant(raw.since, 'since');
  } else {
    const days = raw.days?.trim() ? Number(raw.days) : 7;
    if (!Number.isFinite(days) || days <= 0) throw new Error(`Invalid days "${raw.days}". Use a positive number.`);
    since = new Date(until.getTime() - days * 86_400_000);
  }
  if (since >= until) throw new Error(`since (${iso(since)}) must be before until (${iso(until)}).`);
  return {
    since: iso(since),
    until: iso(until),
    days: Math.round(((until.getTime() - since.getTime()) / 86_400_000) * 100) / 100,
  };
}

/** A whole number of at least 1, or -1 (also empty) for no limit. */
export function parseLimit(value: string | undefined, name: string): number {
  const trimmed = value?.trim();
  if (!trimmed) return -1;
  const number = Number(trimmed);
  if (!Number.isInteger(number) || (number < 1 && number !== -1)) {
    throw new Error(`Invalid ${name} "${value}". Use a whole number of at least 1, or -1 to keep everything.`);
  }
  return number;
}

function parseRestoreUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (!/^https?:\/\/[^\s/]+/i.test(trimmed)) throw new Error(`Invalid restore-url "${value}". Use the address of the published site, starting with https://.`);
  return trimmed;
}

export function parseViewer(value: string | undefined): ViewerSetting {
  const trimmed = value?.trim() ?? '';
  if (!trimmed || trimmed.toLowerCase() === 'default') return { kind: 'default' };
  if (trimmed.toLowerCase() === 'none') return { kind: 'none' };
  if (/^https:\/\//i.test(trimmed)) return { kind: 'url', url: trimmed };
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) throw new Error(`Invalid viewer "${value}". URLs must use https.`);
  return { kind: 'file', path: trimmed };
}

export function buildConfig(raw: RawInputs, knownComponents: string[], now = new Date()): Config {
  const repositories = [...new Set(parseList(raw.repositories).map(parseRepository))];
  if (repositories.length === 0) throw new Error('No repositories given. Set the "repositories" input.');

  const components = parseList(raw.components).map((c) => c.toLowerCase());
  const selected = components.length ? [...new Set(components)] : DEFAULT_COMPONENTS;
  if (selected.includes('html')) {
    throw new Error(
      'The "html" component was replaced by the viewer: reports are now pulse/DATE.json and pulse/DATE.md, and index.html is a viewer that renders the JSON in the browser. Remove "html" from components; see the "viewer" input.',
    );
  }
  const unknown = selected.filter((c) => !knownComponents.includes(c));
  if (unknown.length) {
    throw new Error(`Unknown component(s): ${unknown.join(', ')}. Available: ${knownComponents.join(', ')}.`);
  }

  return {
    repositories,
    components: selected,
    window: parseWindow(raw, now),
    outputDirectory: raw['output-directory']?.trim() || 'repository-pulse',
    token: raw.token?.trim() || undefined,
    apiUrl: raw['api-url']?.trim() || undefined,
    ignoreUsers: parseList(raw['ignore-users']),
    title: raw.title?.trim() || 'Repository pulse',
    retention: { days: parseLimit(raw['history-days'], 'history-days'), count: parseLimit(raw['history-count'], 'history-count') },
    viewer: parseViewer(raw.viewer),
    restoreUrl: parseRestoreUrl(raw['restore-url']),
  };
}

/** Bots are excluded from comments, reviews, mentions and contributors. */
export function makeIgnoreFilter(extra: string[]) {
  const ignored = new Set(extra.map((u) => u.toLowerCase()));
  const seen = new Set<string>();
  const isIgnored = (login: string | null | undefined, type?: string | null): boolean => {
    if (!login) return true;
    const lower = login.toLowerCase();
    const result =
      type === 'Bot' || ignored.has(lower) || /\[bot\]$/.test(lower) || /(^|[-_])bot$/.test(lower);
    if (result) seen.add(login);
    return result;
  };
  return { isIgnored, seen };
}
