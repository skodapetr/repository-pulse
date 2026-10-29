import { appendFile } from 'node:fs/promises';
import { day } from '../util.js';
import type { Component } from './index.js';

export const stepSummaryComponent: Component = {
  name: 'step-summary',
  description: 'Short Markdown overview (numbers and waiting items) on the workflow run page via GITHUB_STEP_SUMMARY.',
  async run(report, { title, log }) {
    const file = process.env.GITHUB_STEP_SUMMARY;
    if (!file) {
      log('step-summary: GITHUB_STEP_SUMMARY is not set, skipping.');
      return [];
    }
    const lines = [
      `## ${title}: ${day(report.window.since)} → ${day(report.window.until)}`,
      '',
      '| Repository | Issues +/− | PRs opened / merged | Commits | Comments | Open issues | Open PRs |',
      '|---|---|---|---|---|---|---|',
      ...report.repositories.map((r) => {
        const n = r.numbers;
        return `| [${r.name}](${r.url}) | +${n.issuesOpened} / −${n.issuesClosed} | ${n.pullRequestsOpened} / ${n.pullRequestsMerged} | ${n.defaultBranchCommits} | ${n.comments} | ${r.totals.openIssues} | ${r.totals.openPullRequests} |`;
      }),
      '',
      '### Waiting on someone',
      '',
      ...(report.waiting.length
        ? report.waiting.map(
            (w) =>
              `- [${w.repository}#${w.number}](${w.url}) ${w.title} → **${w.waitingOn.join(', ') || 'nobody assigned'}** (${w.reasons.map((r) => r.code).join(', ')})`,
          )
        : ['Nothing detected.']),
      '',
    ];
    await appendFile(file, lines.join('\n'));
    log('step-summary: added to the job summary');
    return [];
  },
};
