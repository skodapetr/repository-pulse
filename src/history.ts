import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { MANIFEST_VERSION, type Manifest, type ManifestEntry, type TimeWindow } from './model.js';

export const MANIFEST_FILE = 'manifest.json';
export const REPORT_DIRECTORY = 'pulse';

export interface Retention {
  /** Delete reports more than this many days older than the newest one. -1 keeps all. */
  days: number;
  /** Keep only this many of the newest reports. -1 keeps all. */
  count: number;
}

/** One report per day, named by the (UTC) day the window ends. */
export function reportDate(window: TimeWindow): string {
  return window.until.slice(0, 10);
}

/** Path of a report file relative to the output directory and the manifest. */
export function reportPath(kind: 'json' | 'markdown', date: string): string {
  return `${REPORT_DIRECTORY}/${date}.${kind === 'json' ? 'json' : 'md'}`;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function isEntry(value: unknown): value is ManifestEntry {
  const e = value as ManifestEntry;
  return (
    !!e &&
    typeof e.date === 'string' &&
    DATE.test(e.date) &&
    typeof e.generatedAt === 'string' &&
    typeof e.title === 'string' &&
    !!e.window &&
    !!e.files &&
    typeof e.files === 'object'
  );
}

/** Parse and validate manifest text. Throws on anything that is not a manifest this version understands. */
export function parseManifest(text: string, source = MANIFEST_FILE): Manifest {
  let data: Manifest;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`${source} is not valid JSON. Fix or delete it; refusing to continue because that would lose the history.`);
  }
  if (!data || typeof data !== 'object' || !Array.isArray(data.reports)) {
    throw new Error(`${source} is not a manifest (no "reports" list).`);
  }
  if (data.schemaVersion !== MANIFEST_VERSION) {
    throw new Error(`${source} has schemaVersion ${data.schemaVersion}, this version understands ${MANIFEST_VERSION}.`);
  }
  if (!data.reports.every(isEntry)) throw new Error(`${source} has malformed report entries.`);
  return normalize(data.reports);
}

/** Newest first, one entry per date (the last one given wins), `latest` set. */
export function normalize(entries: ManifestEntry[]): Manifest {
  const byDate = new Map<string, ManifestEntry>();
  for (const entry of entries) byDate.set(entry.date, entry);
  const reports = [...byDate.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return { schemaVersion: MANIFEST_VERSION, latest: reports[0]?.date ?? '', reports };
}

/** Missing manifest is an empty one; a broken manifest is an error. */
export async function loadManifest(directory: string): Promise<Manifest> {
  let text: string;
  try {
    text = await readFile(join(directory, MANIFEST_FILE), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return normalize([]);
    throw error;
  }
  return parseManifest(text, join(directory, MANIFEST_FILE));
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Drop entries whose files are not on disk, so navigation never leads to a missing report. */
export async function dropMissing(manifest: Manifest, directory: string, log: (message: string) => void): Promise<Manifest> {
  const kept: ManifestEntry[] = [];
  for (const entry of manifest.reports) {
    const files = Object.values(entry.files);
    const present = await Promise.all(files.map((f) => exists(join(directory, f))));
    if (files.length > 0 && present.every(Boolean)) kept.push(entry);
    else log(`history: dropping ${entry.date} from the manifest, its files are missing.`);
  }
  return normalize(kept);
}

export function upsert(manifest: Manifest, entry: ManifestEntry): Manifest {
  return normalize([...manifest.reports.filter((e) => e.date !== entry.date), entry]);
}

/** Apply both rules; a report goes when either says so. The newest report always stays. */
export function prune(manifest: Manifest, retention: Retention): { manifest: Manifest; removed: ManifestEntry[] } {
  const [newest, ...older] = manifest.reports;
  if (!newest) return { manifest, removed: [] };
  const newestMs = Date.parse(`${newest.date}T00:00:00Z`);
  const kept = [newest];
  const removed: ManifestEntry[] = [];
  older.forEach((entry, index) => {
    const ageDays = (newestMs - Date.parse(`${entry.date}T00:00:00Z`)) / 86_400_000;
    const tooOld = retention.days >= 0 && ageDays > retention.days;
    const tooMany = retention.count >= 0 && index + 2 > retention.count;
    (tooOld || tooMany ? removed : kept).push(entry);
  });
  return { manifest: normalize(kept), removed };
}

/** Write via a temporary file so a failure never leaves a half-written manifest. */
export async function writeManifest(directory: string, manifest: Manifest): Promise<string> {
  const file = join(directory, MANIFEST_FILE);
  const temporary = `${file}.tmp`;
  await mkdir(dirname(file), { recursive: true });
  await writeFile(temporary, JSON.stringify(manifest, null, 2) + '\n');
  await rename(temporary, file);
  return file;
}

export async function removeReportFiles(directory: string, entries: ManifestEntry[]): Promise<void> {
  for (const entry of entries) {
    for (const file of Object.values(entry.files)) await rm(join(directory, file), { force: true });
  }
}

type Fetch = (url: string) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/**
 * Download the manifest and the files it lists from a published site into the
 * output directory, so a run adds to the history instead of starting it over.
 * A missing manifest (404) means a first run. Any other failure throws.
 */
export async function restoreFromUrl(
  base: string,
  directory: string,
  log: (message: string) => void,
  fetchFn: Fetch = (url) => fetch(url),
): Promise<void> {
  const root = base.endsWith('/') ? base : `${base}/`;
  const response = await fetchFn(new URL(MANIFEST_FILE, root).href);
  if (response.status === 404) {
    log(`restore: no ${MANIFEST_FILE} at ${root}, starting a new history.`);
    return;
  }
  if (!response.ok) throw new Error(`restore: ${root}${MANIFEST_FILE} answered HTTP ${response.status}.`);
  const manifest = parseManifest(await response.text(), `${root}${MANIFEST_FILE}`);
  let count = 0;
  for (const entry of manifest.reports) {
    for (const file of Object.values(entry.files)) {
      const target = join(directory, file);
      if (await exists(target)) continue;
      const res = await fetchFn(new URL(file, root).href);
      if (!res.ok) throw new Error(`restore: ${root}${file} answered HTTP ${res.status}.`);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, await res.text());
      count++;
    }
  }
  await mkdir(directory, { recursive: true });
  await writeManifest(directory, manifest);
  log(`restore: ${manifest.reports.length} reports in the history, downloaded ${count} files from ${root}`);
}
