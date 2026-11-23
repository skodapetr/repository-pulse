import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { COMPONENT_NAMES } from '../src/components/index.js';
import { buildConfig, type RawInputs } from '../src/config.js';
import { dropMissing, loadManifest } from '../src/history.js';
import { writeOutputs } from '../src/run.js';
import { renderViewerPage } from '../src/viewer.js';
import { sampleReport } from './fixture.js';

async function runOn(dir: string, until: string, extra: RawInputs = {}) {
  const config = buildConfig({ repositories: 'o/alpha, o/beta', 'output-directory': dir, ...extra }, COMPONENT_NAMES);
  const previous = await dropMissing(await loadManifest(dir), dir, () => {});
  return writeOutputs(sampleReport(until), config, previous, () => {});
}

test('a run writes dated files, the manifest, the viewer and the agent instructions', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pulse-out-'));
  const files = await runOn(dir, '2026-11-14');
  for (const f of ['index.html', 'pulse.md', 'manifest.json', 'pulse/2026-11-14.json', 'pulse/2026-11-14.md']) {
    assert.ok(existsSync(join(dir, f)), f);
  }
  assert.ok(!existsSync(join(dir, 'html')));
  assert.equal(files.manifest[0], join(dir, 'manifest.json'));

  const manifest = await loadManifest(dir);
  assert.equal(manifest.latest, '2026-11-14');
  assert.deepEqual(manifest.reports[0].files, { json: 'pulse/2026-11-14.json', markdown: 'pulse/2026-11-14.md' });

  const entry = await readFile(join(dir, 'pulse.md'), 'utf8');
  assert.match(entry, /manifest\.json/);
  assert.match(entry, /reports\[0\]/);
  assert.match(await readFile(join(dir, 'index.html'), 'utf8'), /name="pulse-manifest" content="manifest.json"/);
});

test('history accumulates, reruns of a day overwrite, retention deletes files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pulse-out-'));
  for (const d of ['2026-11-07', '2026-11-14', '2026-11-14', '2026-11-21']) await runOn(dir, d);
  assert.deepEqual((await loadManifest(dir)).reports.map((r) => r.date), ['2026-11-21', '2026-11-14', '2026-11-07']);

  await runOn(dir, '2026-11-28', { 'history-count': '2' });
  assert.deepEqual((await loadManifest(dir)).reports.map((r) => r.date), ['2026-11-28', '2026-11-21']);
  assert.ok(!existsSync(join(dir, 'pulse/2026-11-14.json')));
  assert.ok(!existsSync(join(dir, 'pulse/2026-11-07.md')));
  assert.ok(existsSync(join(dir, 'pulse/2026-11-21.json')));
});

test('components decide which files an entry lists; viewer none writes no index.html', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pulse-out-'));
  await runOn(dir, '2026-11-14', { components: 'json', viewer: 'none' });
  assert.deepEqual((await loadManifest(dir)).reports[0].files, { json: 'pulse/2026-11-14.json' });
  assert.ok(!existsSync(join(dir, 'index.html')));
  assert.ok(!existsSync(join(dir, 'pulse.md')));
});

test('viewer from a file is inlined, from a URL is linked', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pulse-out-'));
  const custom = join(dir, 'my-viewer.js');
  await writeFile(custom, 'document.title = "x"; // </script> tricks');
  const out = join(dir, 'site');
  await runOn(out, '2026-11-14', { viewer: custom });
  const page = await readFile(join(out, 'index.html'), 'utf8');
  assert.match(page, /document\.title = "x"/);
  assert.equal(page.match(/<\/script>/g)?.length, 1, 'the closing tag inside the script must be escaped');

  const linked = renderViewerPage('T & "Q"', { url: 'https://cdn.test/v.js?a=1&b=2' });
  assert.match(linked, /src="https:\/\/cdn\.test\/v\.js\?a=1&amp;b=2"/);
  assert.match(linked, /<title>T &amp; &quot;Q&quot;<\/title>/);
});

test('a broken manifest stops the run instead of dropping the history', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pulse-out-'));
  await writeFile(join(dir, 'manifest.json'), '{broken');
  await assert.rejects(loadManifest(dir), /not valid JSON/);
});
