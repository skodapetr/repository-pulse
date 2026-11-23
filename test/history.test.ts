import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  dropMissing,
  loadManifest,
  normalize,
  parseManifest,
  prune,
  removeReportFiles,
  reportDate,
  reportPath,
  restoreFromUrl,
  upsert,
  writeManifest,
} from '../src/history.js';
import type { ManifestEntry } from '../src/model.js';

function entry(date: string, files: ManifestEntry['files'] = { json: reportPath('json', date) }): ManifestEntry {
  return {
    date,
    generatedAt: `${date}T05:00:00Z`,
    title: 'T',
    window: { since: `${date}T00:00:00Z`, until: `${date}T00:00:00Z`, days: 7 },
    files,
  };
}

const dates = (m: { reports: ManifestEntry[] }) => m.reports.map((r) => r.date);

test('report date is the day the window ends', () => {
  assert.equal(reportDate({ since: '2026-10-22T00:00:00Z', until: '2026-10-29T13:01:02Z', days: 7 }), '2026-10-29');
  assert.equal(reportPath('json', '2026-10-29'), 'pulse/2026-10-29.json');
  assert.equal(reportPath('markdown', '2026-10-29'), 'pulse/2026-10-29.md');
});

test('upsert keeps newest first, one entry per day, and sets latest', () => {
  let m = normalize([]);
  assert.equal(m.latest, '');
  m = upsert(m, entry('2026-11-02'));
  m = upsert(m, entry('2026-11-09'));
  m = upsert(m, entry('2026-11-05'));
  assert.deepEqual(dates(m), ['2026-11-09', '2026-11-05', '2026-11-02']);
  assert.equal(m.latest, '2026-11-09');
  const replaced = upsert(m, { ...entry('2026-11-05'), title: 'Rerun' });
  assert.deepEqual(dates(replaced), ['2026-11-09', '2026-11-05', '2026-11-02']);
  assert.equal(replaced.reports[1].title, 'Rerun');
});

const week = normalize(['2026-11-21', '2026-11-14', '2026-11-07', '2026-10-31', '2026-10-24'].map((d) => entry(d)));

test('prune keeps everything by default (-1)', () => {
  const { manifest, removed } = prune(week, { days: -1, count: -1 });
  assert.equal(manifest.reports.length, 5);
  assert.equal(removed.length, 0);
});

test('prune by days is relative to the newest report', () => {
  const { manifest, removed } = prune(week, { days: 14, count: -1 });
  assert.deepEqual(dates(manifest), ['2026-11-21', '2026-11-14', '2026-11-07']);
  assert.deepEqual(dates({ reports: removed }), ['2026-10-31', '2026-10-24']);
});

test('prune by count', () => {
  assert.deepEqual(dates(prune(week, { days: -1, count: 2 }).manifest), ['2026-11-21', '2026-11-14']);
});

test('prune with both rules removes what either rule removes', () => {
  assert.deepEqual(dates(prune(week, { days: 21, count: 2 }).manifest), ['2026-11-21', '2026-11-14']);
  assert.deepEqual(dates(prune(week, { days: 7, count: 4 }).manifest), ['2026-11-21', '2026-11-14']);
});

test('the newest report is never pruned', () => {
  const old = normalize([entry('2026-01-01')]);
  assert.deepEqual(dates(prune(old, { days: 1, count: 1 }).manifest), ['2026-01-01']);
});

test('manifest parsing rejects broken input instead of starting over', () => {
  assert.throws(() => parseManifest('{nope'), /not valid JSON/);
  assert.throws(() => parseManifest('{"schemaVersion":1}'), /not a manifest/);
  assert.throws(() => parseManifest('{"schemaVersion":9,"reports":[]}'), /schemaVersion/);
  assert.throws(() => parseManifest('{"schemaVersion":1,"reports":[{"date":"x"}]}'), /malformed/);
});

async function scratch(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'pulse-history-'));
}

test('load, write, drop missing and remove files on disk', async () => {
  const dir = await scratch();
  assert.deepEqual((await loadManifest(dir)).reports, []);

  await mkdir(join(dir, 'pulse'));
  await writeFile(join(dir, reportPath('json', '2026-11-14')), '{}');
  const manifest = normalize([entry('2026-11-14'), entry('2026-11-07')]);
  await writeManifest(dir, manifest);
  assert.ok(!existsSync(join(dir, 'manifest.json.tmp')));
  assert.deepEqual(dates(await loadManifest(dir)), ['2026-11-14', '2026-11-07']);

  const messages: string[] = [];
  const kept = await dropMissing(await loadManifest(dir), dir, (m) => messages.push(m));
  assert.deepEqual(dates(kept), ['2026-11-14']);
  assert.match(messages[0], /2026-11-07/);

  await removeReportFiles(dir, kept.reports);
  assert.ok(!existsSync(join(dir, reportPath('json', '2026-11-14'))));
  await removeReportFiles(dir, kept.reports); // already gone: not an error
});

test('restore downloads the manifest and its files, and treats 404 as a first run', async () => {
  const site: Record<string, string> = {
    'https://x.test/p/manifest.json': JSON.stringify(normalize([entry('2026-11-14', { json: 'pulse/2026-11-14.json', markdown: 'pulse/2026-11-14.md' })])),
    'https://x.test/p/pulse/2026-11-14.json': '{"a":1}',
    'https://x.test/p/pulse/2026-11-14.md': '# md',
  };
  const fake = async (url: string) => {
    const body = site[url];
    return { ok: body !== undefined, status: body === undefined ? 404 : 200, text: async () => body ?? '' };
  };
  const dir = await scratch();
  await restoreFromUrl('https://x.test/p', dir, () => {}, fake);
  assert.equal(await readFile(join(dir, 'pulse/2026-11-14.json'), 'utf8'), '{"a":1}');
  assert.deepEqual(dates(await loadManifest(dir)), ['2026-11-14']);

  const empty = await scratch();
  await restoreFromUrl('https://nothing.test/', empty, () => {}, fake);
  assert.deepEqual((await loadManifest(empty)).reports, []);

  const broken = async () => ({ ok: false, status: 500, text: async () => '' });
  await assert.rejects(restoreFromUrl('https://x.test/p', await scratch(), () => {}, broken), /HTTP 500/);
});
