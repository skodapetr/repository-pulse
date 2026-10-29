import { mkdir } from 'node:fs/promises';
import { buildContributors } from './analyze.js';
import { collectRepository } from './collect.js';
import { COMPONENTS } from './components/index.js';
import { makeIgnoreFilter, type Config } from './config.js';
import { GitHubClient } from './github.js';
import { SCHEMA_VERSION, type Report } from './model.js';
import { byTime } from './util.js';

export const VERSION = '0.1.0';

export interface RunResult {
  report: Report;
  files: Record<string, string[]>;
  requests: number;
}

export async function run(config: Config, log: (message: string) => void = console.log): Promise<RunResult> {
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

  await mkdir(config.outputDirectory, { recursive: true });
  const files: Record<string, string[]> = {};
  for (const name of config.components) {
    const component = COMPONENTS.find((c) => c.name === name)!;
    files[name] = await component.run(report, { outputDirectory: config.outputDirectory, title: config.title, log });
    for (const file of files[name]) log(`${name}: wrote ${file}`);
  }
  log(`Done with ${gh.requestCount} GitHub API requests.`);
  return { report, files, requests: gh.requestCount };
}
