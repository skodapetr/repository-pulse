import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CommitItem, Contributor, Report, RepositoryReport, WaitingItem } from '../model.js';
import { day } from '../util.js';
import type { Component } from './index.js';

/**
 * Markdown meant to be read by an agent (or a person) that writes the
 * narrative: dense, deterministic, every item with a stable reference and
 * enough context (excerpts, recent comments) to say what is being discussed.
 */
export const agentComponent: Component = {
  name: 'agent',
  description: 'Agent-ready Markdown as pulse.md: all facts, stable references, excerpts of descriptions and comments.',
  async run(report, { outputDirectory, title }) {
    const file = join(outputDirectory, 'pulse.md');
    await writeFile(file, renderAgentMarkdown(report, title));
    return [file];
  },
};

const quote = (text: string) => (text ? `  > ${text}` : '');

export function renderAgentMarkdown(report: Report, title = 'Repository pulse'): string {
  const out: string[] = [];
  const w = report.window;

  out.push(
    `# ${title}`,
    '',
    `- Window: ${w.since} to ${w.until} (${w.days} days, end exclusive, UTC)`,
    `- Generated: ${report.generatedAt} by ${report.generator.name} ${report.generator.version}`,
    `- Repositories: ${report.repositories.map((r) => r.name).join(', ')}`,
    `- Excluded as bots or ignored: ${report.ignoredUsers.join(', ') || 'none'}`,
    '',
    'Notes for the reader: references like `owner/repo#123` identify issues and pull requests; inside a repository section `#123` refers to that repository. ' +
      'Totals (open issues, stars) are at generation time; everything else is limited to the window. ' +
      '"Waiting on" is computed by fixed rules from the latest activity and names who is expected to act, not what the decision is; use the discussion excerpts for that. ' +
      'Texts after `>` are truncated excerpts.',
    '',
    '## Overview',
    '',
    '| Repository | Issues opened | Issues closed | PRs opened | PRs merged | PRs closed unmerged | Default-branch commits | PR-branch commits | Comments | Reviews | New forks | Releases | Open issues | Open PRs | Stars |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  );
  for (const r of report.repositories) {
    const n = r.numbers;
    out.push(
      `| ${r.name} | ${n.issuesOpened} | ${n.issuesClosed} | ${n.pullRequestsOpened} | ${n.pullRequestsMerged} | ${n.pullRequestsClosedUnmerged} | ${n.defaultBranchCommits} | ${n.pullRequestBranchCommits} | ${n.comments} | ${n.reviews} | ${n.newForks} | ${n.releases} | ${r.totals.openIssues} | ${r.totals.openPullRequests} | ${r.totals.stars} |`,
    );
  }

  out.push('', '## Waiting on someone', '');
  if (!report.waiting.length) out.push('Nothing detected.');
  for (const item of report.waiting) out.push(...waitingLines(item));

  for (const repo of report.repositories) out.push('', ...repositorySection(repo));

  out.push('', '## Contributors', '', 'Across all repositories, most active first.');
  for (const c of report.contributors) out.push('', ...contributorLines(c, report.repositories.length > 1));

  return out.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
}

function waitingLines(item: WaitingItem): string[] {
  const who = item.waitingOn.length ? item.waitingOn.join(', ') : 'nobody assigned';
  return [
    `- ${item.repository}#${item.number} (${item.kind}${item.draft ? ', draft' : ''}) "${item.title}" → ${who}; since ${day(item.since)}`,
    ...item.reasons.map((r) => `  - ${r.code}: ${r.detail}`),
  ];
}

function repositorySection(repo: RepositoryReport): string[] {
  const out: string[] = [`## ${repo.name}`, ''];
  const n = repo.numbers;
  out.push(
    `Default branch \`${repo.defaultBranch}\`. In the window: ${n.issuesOpened} issues opened, ${n.issuesClosed} closed; ` +
      `${n.pullRequestsOpened} PRs opened, ${n.pullRequestsMerged} merged, ${n.pullRequestsClosedUnmerged} closed unmerged; ` +
      `${n.defaultBranchCommits} commits on ${repo.defaultBranch} (+${n.mergeCommits} merge commits), ${n.pullRequestBranchCommits} on PR branches; ` +
      `${n.comments} comments, ${n.reviews} reviews.`,
  );

  out.push('', '### Merged pull requests', '');
  if (!repo.pullRequests.merged.length) out.push('None.');
  for (const p of repo.pullRequests.merged) {
    out.push(
      `- #${p.number} "${p.title}" by ${p.author}, into \`${p.baseRef}\`, merged ${day(p.mergedAt)} by ${p.mergedBy ?? 'unknown'}, +${p.additions}/−${p.deletions} in ${p.changedFiles} files`,
    );
    const q = quote(p.bodyExcerpt);
    if (q) out.push(q);
  }

  out.push('', `### Commits on ${repo.defaultBranch}`, '');
  out.push(...commitGroups(repo.commits.defaultBranch, 'direct, not from a known pull request'));

  out.push('', '### Pull requests opened', '');
  if (!repo.pullRequests.opened.length) out.push('None.');
  for (const p of repo.pullRequests.opened) {
    const flags = [p.state === 'open' ? (p.draft ? 'draft' : 'open') : p.mergedAt ? 'merged' : 'closed'];
    if (p.headRepository) flags.push(`from fork ${p.headRepository}`);
    const reviewers = [...p.requestedReviewers, ...p.requestedTeams];
    out.push(
      `- #${p.number} "${p.title}" by ${p.author} (${flags.join(', ')}), \`${p.headRef}\` → \`${p.baseRef}\`, +${p.additions}/−${p.deletions} in ${p.changedFiles} files` +
        (reviewers.length ? `, review requested from ${reviewers.join(', ')}` : '') +
        (p.labels.length ? `, labels: ${p.labels.join(', ')}` : ''),
    );
    const q = quote(p.bodyExcerpt);
    if (q) out.push(q);
  }

  if (repo.pullRequests.updated.length) {
    out.push('', '### Older open pull requests with activity', '');
    for (const p of repo.pullRequests.updated) {
      out.push(`- #${p.number} "${p.title}" by ${p.author}${p.draft ? ' (draft)' : ''}, opened ${day(p.createdAt)}`);
    }
  }

  if (repo.pullRequests.closedUnmerged.length) {
    out.push('', '### Pull requests closed without merging', '');
    for (const p of repo.pullRequests.closedUnmerged) out.push(`- #${p.number} "${p.title}" by ${p.author}, closed ${day(p.closedAt)}`);
  }

  if (repo.commits.pullRequestBranches.length) {
    out.push('', '### Commits on open pull request branches', '');
    out.push(...commitGroups(repo.commits.pullRequestBranches, ''));
  }

  out.push('', '### Issues opened', '');
  if (!repo.issues.opened.length) out.push('None.');
  for (const i of repo.issues.opened) {
    out.push(
      `- #${i.number} "${i.title}" by ${i.author} (${i.state})` +
        (i.labels.length ? `, labels: ${i.labels.join(', ')}` : '') +
        `, assignees: ${i.assignees.join(', ') || 'none'}`,
    );
    const q = quote(i.bodyExcerpt);
    if (q) out.push(q);
  }

  out.push('', '### Issues closed', '');
  if (!repo.issues.closed.length) out.push('None.');
  for (const i of repo.issues.closed) {
    out.push(
      `- #${i.number} "${i.title}" by ${i.author}, opened ${day(i.createdAt)}, closed ${day(i.closedAt)} by ${i.closedBy ?? 'unknown'}` +
        (i.stateReason ? ` (${i.stateReason})` : ''),
    );
  }

  out.push('', '### Discussions', '');
  if (!repo.discussions.length) out.push('No human comments in the window.');
  for (const d of repo.discussions) {
    out.push(
      `- #${d.number} (${d.kind}, ${d.state}) "${d.title}": ${d.commentCount} comments; ` +
        d.participants.map((p) => `${p.login} ${p.comments}`).join(', '),
    );
    for (const c of d.recentComments) out.push(`  - ${day(c.createdAt)} ${c.author}: ${c.bodyExcerpt}`);
  }

  if (repo.forks.length) {
    out.push('', '### New forks', '');
    for (const f of repo.forks) out.push(`- ${f.fullName}, ${day(f.createdAt)}`);
  }
  if (repo.releases.length) {
    out.push('', '### Releases', '');
    for (const r of repo.releases) out.push(`- ${r.tag} "${r.name}" by ${r.author}, ${day(r.publishedAt)}${r.prerelease ? ' (pre-release)' : ''}`);
  }
  return out;
}

function commitGroups(commits: CommitItem[], directLabel: string): string[] {
  if (!commits.length) return ['None.'];
  const groups = new Map<string, CommitItem[]>();
  for (const c of commits) {
    const key = c.pullRequest ? `#${c.pullRequest}` : directLabel;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  const out: string[] = [];
  for (const [key, list] of groups) {
    out.push(`- ${key.startsWith('#') ? `via ${key}` : key}: ${list.length} commit${list.length === 1 ? '' : 's'}`);
    for (const c of list) out.push(`  - ${day(c.date)} ${c.author} ${c.sha.slice(0, 7)} ${c.message}`);
  }
  return out;
}

function contributorLines(c: Contributor, multiRepo: boolean): string[] {
  const ref = (x: { repository: string; number: number }) => (multiRepo ? `${x.repository}#${x.number}` : `#${x.number}`);
  const refs = (list: Array<{ repository: string; number: number; title: string }>) =>
    list.map((x) => `${ref(x)} "${x.title}"`).join('; ');
  const out = [`### ${c.login}${c.isLogin ? '' : ' (git author name, no linked account)'}`, ''];
  if (multiRepo) out.push(`- Repositories: ${c.repositories.join(', ')}`);
  if (c.commits.length) {
    out.push(
      `- Commits (${c.commits.length}): ` +
        c.commits.map((x) => `${x.message}${x.pullRequest ? ` [${ref({ repository: x.repository, number: x.pullRequest })}]` : ''}`).join('; '),
    );
  }
  if (c.pullRequestsOpened.length) out.push(`- Pull requests opened: ${refs(c.pullRequestsOpened)}`);
  if (c.pullRequestsMerged.length) out.push(`- Own pull requests merged: ${refs(c.pullRequestsMerged)}`);
  if (c.pullRequestsMergedForOthers.length) out.push(`- Merged for others: ${refs(c.pullRequestsMergedForOthers)}`);
  if (c.reviews.length) out.push(`- Reviews: ${c.reviews.map((r) => `${ref(r)} ${r.state.toLowerCase()}`).join('; ')}`);
  if (c.issuesOpened.length) out.push(`- Issues opened: ${refs(c.issuesOpened)}`);
  if (c.issuesClosed.length) out.push(`- Issues closed: ${refs(c.issuesClosed)}`);
  if (c.comments.length) out.push(`- Comments: ${c.comments.map((x) => `${ref(x)} ×${x.count}`).join('; ')}`);
  if (c.waitingOn.length) out.push(`- Expected to act on: ${refs(c.waitingOn)}`);
  if (c.activity === 0) out.push('- No activity in the window.');
  return out;
}
