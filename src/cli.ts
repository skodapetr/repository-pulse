/**
 * Command line entry point, for local runs and agents:
 *
 *   node dist/cli.js --repositories dataspecer/dataspecer --days 7 --components json,agent
 *
 * Every action input is accepted as --<input-name> <value>. The token defaults
 * to GITHUB_TOKEN or GH_TOKEN.
 */
import { COMPONENTS, COMPONENT_NAMES } from './components/index.js';
import { buildConfig, type RawInputs } from './config.js';
import { run, VERSION } from './run.js';

const HELP = `repository-pulse ${VERSION}

Usage: repository-pulse --repositories <owner/name,...> [options]

Options:
  --repositories      Repositories, comma or newline separated (required)
  --components        Components to run (default: json,agent)
  --days              Window length in days, ending at --until (default: 7)
  --since             Window start, YYYY-MM-DD or ISO 8601 (overrides --days)
  --until             Window end, exclusive (default: now)
  --output-directory  Where to write files (default: repository-pulse)
  --token             GitHub token (default: $GITHUB_TOKEN or $GH_TOKEN)
  --api-url           GitHub API URL (default: https://api.github.com)
  --ignore-users      Extra logins to treat as bots
  --title             Report title (default: Repository pulse)
  --history-days      Delete reports older than this many days (default: -1, keep all)
  --history-count     Keep only the newest N reports (default: -1, keep all)
  --viewer            default, none, a path to a viewer script, or an https URL of one
  --restore-url       Published site to download earlier reports from before running

Components:
${COMPONENTS.map((c) => `  ${c.name.padEnd(14)} ${c.description}`).join('\n')}
`;

function parseArgs(argv: string[]): RawInputs {
  const raw: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      console.log(HELP);
      process.exit(0);
    }
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument "${arg}". See --help.`);
    const [key, inline] = arg.slice(2).split(/=(.*)/s, 2);
    const value = inline ?? argv[++i];
    if (value === undefined) throw new Error(`Missing value for --${key}.`);
    raw[key] = value;
  }
  return raw as RawInputs;
}

async function main(): Promise<void> {
  const raw = parseArgs(process.argv.slice(2));
  raw.token ||= process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  raw['api-url'] ||= process.env.GITHUB_API_URL;
  const config = buildConfig(raw, COMPONENT_NAMES);
  await run(config, (m) => console.error(m));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
