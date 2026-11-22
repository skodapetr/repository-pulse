import { mkdir } from 'node:fs/promises';
import { dropMissing, loadManifest, prune, removeReportFiles, reportDate, reportPath, restoreFromUrl, upsert, writeManifest } from './history.js';
import { writeViewer } from './viewer.js';
import { buildContributors } from './analyze.js';
import { collectRepository } from './collect.js';
import { COMPONENTS } from './components/index.js';
import { makeIgnoreFilter, type Config } from './config.js';
import { GitHubClient } from './github.js';
import { SCHEMA_VERSION, type Manifest, type ManifestEntry, type Report } from './model.js';
import { byTime } from './util.js';

export const VERSION = '0.2.0';

export interface RunResult {
  report: Report;
  files: Record<string, string[]>;
  requests: number;
}

export async function run(config: Config, log: (message: string) => void = console.log): Promise<RunResult> {
  await mkdir(config.outputDirectory, { recursive: true });
  if (config.restoreUrl) await restoreFromUrl(config.restoreUrl, config.outputDirectory, log);
  // Read the earlier history first: a broken manifest should stop the run before any API calls.
  const previous = await dropMissing(await loadManifest(config.outputDirectory), config.outputDirectory, log);

  const gh = new GitHubClient({ token: config.token, apiUrl: config.apiUrl, log });
  const { isIgnored, seen } = makeIgnoreFilter(config.ignoreUsers);

  const repositories = [];
  const waiting = [];
  for (const name of config.repositories) {
    const result = await collectRepository(name, { gh, window: config.window, isIgnored, log });
    repositories.push(result.report);
    waiting.push(...result.waiting);
  }

  waiting.sort(byTime((w) => w.since));
  const report: Report = {
    schemaVersion: SCHEMA_VERSION,
    generator: { name: 'repository-pulse', version: VERSION },
    generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    window: config.window,
    ignoredUsers: [...seen].sort(),
    repositories,
    contributors: buildContributors(repositories, waiting),
    waiting,
  };

  const files = await writeOutputs(report, config, previous, log);
  log(`Done with ${gh.requestCount} GitHub API requests.`);
  return { report, files, requests: gh.requestCount };
}

/**
 * Writes the report files, then updates the manifest and the viewer. `previous`
 * is the manifest found in the output directory before this run.
 */
export async function writeOutputs(report: Report, config: Config, previous: Manifest, log: (message: string) => void): Promise<Record<string, string[]>> {
  const files: Record<string, string[]> = {};
  for (const name of config.components) {
    const component = COMPONENTS.find((c) => c.name === name)!;
    files[name] = await component.run(report, { outputDirectory: config.outputDirectory, title: config.title, log });
    for (const file of files[name]) log(`${name}: wrote ${file}`);
  }

  // The manifest comes last: it must never list files that were not written.
  const date = reportDate(report.window);
  const reportFiles: ManifestEntry['files'] = {};
  if (config.components.includes('json')) reportFiles.json = reportPath('json', date);
  if (config.components.includes('agent')) reportFiles.markdown = reportPath('markdown', date);
  if (Object.keys(reportFiles).length === 0) {
    log('history: neither json nor agent ran, so there is no report to add to the manifest.');
  } else {
    const entry: ManifestEntry = { date, generatedAt: report.generatedAt, title: config.title, window: report.window, files: reportFiles };
    const { manifest, removed } = prune(upsert(previous, entry), config.retention);
    await removeReportFiles(config.outputDirectory, removed);
    for (const r of removed) log(`history: removed ${r.date}`);
    files.manifest = [await writeManifest(config.outputDirectory, manifest)];
    log(`history: ${manifest.reports.length} report(s) in the manifest, latest ${manifest.latest}`);
    if (config.viewer.kind !== 'none' && !reportFiles.json) log('viewer: the viewer reads pulse/DATE.json; add "json" to components or it has nothing to show.');
    const index = await writeViewer(config.outputDirectory, config.title, config.viewer);
    if (index) {
      files.viewer = [index];
      log(`viewer: wrote ${index}`);
    }
  }
  return files;
}
