/** GitHub Action entry point. Reads INPUT_* variables and writes step outputs. */
import { appendFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { COMPONENT_NAMES } from './components/index.js';
import { buildConfig, type RawInputs } from './config.js';
import { run } from './run.js';

const INPUTS: Array<keyof RawInputs> = [
  'repositories',
  'components',
  'days',
  'since',
  'until',
  'output-directory',
  'token',
  'api-url',
  'ignore-users',
  'title',
  'history-days',
  'history-count',
  'viewer',
  'restore-url',
];

function input(name: string): string | undefined {
  return process.env[`INPUT_${name.replace(/ /g, '_').toUpperCase()}`];
}

function setOutput(name: string, value: string): void {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  const delimiter = `ghadelimiter_${randomUUID()}`;
  appendFileSync(file, `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
}

async function main(): Promise<void> {
  const raw: RawInputs = {};
  for (const name of INPUTS) raw[name] = input(name);
  raw['api-url'] ||= process.env.GITHUB_API_URL;
  const config = buildConfig(raw, COMPONENT_NAMES);
  if (config.token) console.log(`::add-mask::${config.token}`);
  console.log(`Repositories: ${config.repositories.join(', ')}`);
  console.log(`Window: ${config.window.since} → ${config.window.until}`);
  console.log(`Components: ${config.components.join(', ')}`);

  const result = await run(config, (m) => console.log(m));
  const all = Object.values(result.files).flat();
  setOutput('output-directory', resolve(config.outputDirectory));
  setOutput('files', all.join('\n'));
  setOutput('json-file', result.files.json?.[0] ?? '');
  setOutput('agent-file', result.files.agent?.[0] ?? '');
  setOutput('manifest-file', result.files.manifest?.[0] ?? '');
  setOutput('viewer-file', result.files.viewer?.[0] ?? '');
  setOutput('since', config.window.since);
  setOutput('until', config.window.until);
  setOutput('waiting-count', String(result.report.waiting.length));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.log(`::error::${message.replace(/\r?\n/g, '%0A')}`);
  process.exitCode = 1;
});
