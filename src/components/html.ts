import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CommitItem, Contributor, ItemRef, Report, RepositoryReport, WaitingItem } from '../model.js';
import { day, htmlEscape as e } from '../util.js';
import type { Component } from './index.js';

export const htmlComponent: Component = {
  name: 'html',
  description: 'Self-contained web page as index.html (no external assets, light and dark mode).',
  async run(report, { outputDirectory, title }) {
    const file = join(outputDirectory, 'index.html');
    await writeFile(file, renderHtml(report, title));
    return [file];
  },
};

const STYLE = `
:root{--bg:#fafaf9;--surface:#fff;--text:#1c1917;--muted:#6b6560;--line:#e7e5e4;--accent:#2457c5;--accent-soft:#e8eefb;
--ok:#1f7a4d;--ok-soft:#e5f3eb;--warn:#a15c07;--warn-soft:#fbf0de;--bad:#b42318;--bad-soft:#fdecea;
--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;--sans:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
@media (prefers-color-scheme:dark){:root{--bg:#141312;--surface:#1d1c1a;--text:#ece9e6;--muted:#a19c96;--line:#2f2d2a;
--accent:#7fa6f5;--accent-soft:#1c2740;--ok:#6cc79a;--ok-soft:#16291f;--warn:#e4a64e;--warn-soft:#2e2414;--bad:#f08a80;--bad-soft:#331a17}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.55 var(--sans)}
main{max-width:920px;margin:0 auto;padding:32px 16px 64px}
header h1{font-size:26px;margin:0 0 4px;letter-spacing:-.01em}
header p{margin:2px 0;color:var(--muted)}
h2{font-size:20px;margin:44px 0 12px;padding-top:8px;border-top:1px solid var(--line)}
h3{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:26px 0 10px;font-weight:600}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
code{font:13px var(--mono);background:var(--accent-soft);padding:1px 5px;border-radius:4px}
.num{font-family:var(--mono);font-size:13px}
.muted{color:var(--muted)}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.stat{background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:12px 14px}
.stat .v{font:600 22px var(--mono)}.stat .l{color:var(--muted);font-size:13px}.stat .d{font:12px var(--mono);color:var(--muted);margin-top:2px}
.list{background:var(--surface);border:1px solid var(--line);border-radius:8px;margin:0;padding:0;list-style:none}
.list>li{padding:10px 16px;border-top:1px solid var(--line);display:flex;gap:12px;align-items:baseline}
.list>li:first-child{border-top:0}
.list .ref{flex:0 0 auto;min-width:56px}
.list .body{min-width:0;flex:1}
.meta{color:var(--muted);font-size:13px}
.excerpt{color:var(--muted);font-size:13px;margin-top:2px;overflow-wrap:anywhere}
.tag{font-size:11px;font-weight:600;padding:1px 7px;border-radius:10px;white-space:nowrap;margin-right:4px}
.t-merged{background:var(--ok-soft);color:var(--ok)}.t-draft{background:var(--line);color:var(--muted)}
.t-open{background:var(--accent-soft);color:var(--accent)}.t-wait{background:var(--warn-soft);color:var(--warn)}
.t-closed{background:var(--bad-soft);color:var(--bad)}
.empty{color:var(--muted);font-size:14px;margin:0}
details summary{cursor:pointer;color:var(--muted);font-size:13px}
details ul{margin:6px 0 0;padding-left:18px;font-size:13px}
.people{display:grid;gap:12px}
.person{background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:14px 18px}
.person h4{margin:0 0 8px;font-size:16px}.person h4 a{color:var(--text)}
.person dl{margin:0;display:grid;grid-template-columns:110px 1fr;gap:6px 12px}
.person dt{color:var(--muted);font-size:13px;padding-top:1px}.person dd{margin:0;min-width:0}
.person.idle{color:var(--muted)}
table{border-collapse:collapse;width:100%;background:var(--surface);border:1px solid var(--line);border-radius:8px;font-size:14px}
th,td{padding:8px 10px;border-top:1px solid var(--line);text-align:right;white-space:nowrap}
th{font-weight:600;color:var(--muted);font-size:12px;border-top:0}
th:first-child,td:first-child{text-align:left}
.scroll{overflow-x:auto}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
footer{margin-top:44px;color:var(--muted);font-size:12px}
@media (max-width:560px){.person dl{grid-template-columns:1fr}.person dt{margin-top:6px}.list>li{flex-direction:column;gap:2px}}
`;

export function renderHtml(report: Report, title = 'Repository pulse'): string {
  const multi = report.repositories.length > 1;
  const w = report.window;
  const range = `${day(w.since)} – ${day(new Date(Date.parse(w.until) - 1).toISOString())}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(title)} · ${e(range)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<header>
  <h1>${e(title)}</h1>
  <p>${report.repositories.map((r) => `<a href="${e(r.url)}">${e(r.name)}</a>`).join(' · ')}</p>
  <p class="num">${e(w.since)} → ${e(w.until)} (${w.days} days, UTC)</p>
</header>
${multi ? overview(report) : ''}
${report.repositories.map((r) => repositorySection(r, multi)).join('\n')}
<h2 id="contributors">Contributors</h2>
${contributors(report.contributors, multi)}
<h2 id="waiting">Waiting on someone</h2>
${waiting(report.waiting, multi)}
<footer>Generated ${e(report.generatedAt)} by ${e(report.generator.name)} ${e(report.generator.version)} from the GitHub API.
Totals are at generation time; everything else is limited to the window.
Excluded as bots: ${e(report.ignoredUsers.join(', ') || 'none')}.
“Waiting on” is derived by rules from the latest activity.</footer>
</main>
</body>
</html>
`;
}

function overview(report: Report): string {
  const rows = report.repositories
    .map((r) => {
      const n = r.numbers;
      return `<tr><td><a href="#${anchor(r.name)}">${e(r.name)}</a></td><td>+${n.issuesOpened} / −${n.issuesClosed}</td><td>+${n.pullRequestsOpened} / ${n.pullRequestsMerged}</td><td>${n.defaultBranchCommits}</td><td>${n.pullRequestBranchCommits}</td><td>${n.comments}</td><td>${n.reviews}</td><td>${r.totals.openIssues}</td><td>${r.totals.openPullRequests}</td><td>${n.newForks}</td></tr>`;
    })
    .join('');
  return `<h2>Overview</h2>
<div class="scroll"><table><thead><tr><th>Repository</th><th>Issues +/−</th><th>PRs + / merged</th><th>Commits</th><th>PR-branch</th><th>Comments</th><th>Reviews</th><th>Open issues</th><th>Open PRs</th><th>Forks</th></tr></thead>
<tbody>${rows}</tbody></table></div>`;
}

function anchor(name: string): string {
  return 'repo-' + name.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase();
}

function ref(item: { repository: string; number: number; url: string }, multi: boolean, cls = 'ref num'): string {
  const label = multi ? `${item.repository.split('/')[1]}#${item.number}` : `#${item.number}`;
  return `<a class="${cls}" href="${e(item.url)}">${e(label)}</a>`;
}

function itemUrl(repo: string, number: number): string {
  return `https://github.com/${repo}/issues/${number}`;
}

function list(items: string[], emptyText = 'None.'): string {
  return items.length ? `<ul class="list">${items.join('')}</ul>` : `<p class="empty">${e(emptyText)}</p>`;
}

function li(refHtml: string, body: string): string {
  return `<li>${refHtml}<div class="body">${body}</div></li>`;
}

function excerptHtml(text: string): string {
  return text ? `<div class="excerpt">${e(text.length > 220 ? text.slice(0, 219) + '…' : text)}</div>` : '';
}

function repositorySection(repo: RepositoryReport, multi: boolean): string {
  const n = repo.numbers;
  const t = repo.totals;
  const stats = `<div class="stats">
  <div class="stat"><div class="v">+${n.issuesOpened} / −${n.issuesClosed}</div><div class="l">Issues opened / closed</div><div class="d">${t.openIssues} open</div></div>
  <div class="stat"><div class="v">+${n.pullRequestsOpened} / ${n.pullRequestsMerged}</div><div class="l">PRs opened / merged</div><div class="d">${t.openPullRequests} open${n.pullRequestsClosedUnmerged ? ` · ${n.pullRequestsClosedUnmerged} closed unmerged` : ''}</div></div>
  <div class="stat"><div class="v">${n.defaultBranchCommits}</div><div class="l">Commits on ${e(repo.defaultBranch)}</div><div class="d">${e(commitAuthors(repo.commits.defaultBranch) || '—')}</div></div>
  <div class="stat"><div class="v">${n.comments} / ${n.reviews}</div><div class="l">Comments / reviews</div><div class="d">${n.pullRequestBranchCommits} commits on PR branches</div></div>
  <div class="stat"><div class="v">${n.newForks}</div><div class="l">New forks</div><div class="d">${t.forks} total · ${t.stars} stars</div></div>
</div>`;

  // Merged pull requests and commits that reached the default branch.
  const merged = repo.pullRequests.merged.map((p) =>
    li(
      ref(p, multi),
      `<span class="tag t-merged">merged</span>${e(p.title)} <span class="meta">· ${e(p.author)} · into <code>${e(p.baseRef)}</code> · +${p.additions}/−${p.deletions}, ${p.changedFiles} files${p.mergedBy && p.mergedBy !== p.author ? ` · merged by ${e(p.mergedBy)}` : ''}</span>${commitDetails(repo.commits.defaultBranch.filter((c) => c.pullRequest === p.number))}`,
    ),
  );
  const mergedNumbers = new Set(repo.pullRequests.merged.map((p) => p.number));
  const direct = new Map<string, CommitItem[]>();
  for (const c of repo.commits.defaultBranch) {
    if (c.pullRequest && mergedNumbers.has(c.pullRequest)) continue;
    const key = c.pullRequest ? `#${c.pullRequest}` : c.author;
    direct.set(key, [...(direct.get(key) ?? []), c]);
  }
  for (const [key, commits] of direct) {
    const label = key.startsWith('#')
      ? `${commits.length} commit${commits.length > 1 ? 's' : ''} from <a href="${e(itemUrl(repo.name, Number(key.slice(1))))}">${e(key)}</a>`
      : `${commits.length} direct commit${commits.length > 1 ? 's' : ''} by ${e(key)}`;
    merged.push(li(`<span class="ref num meta">direct</span>`, `${label}${commitDetails(commits, true)}`));
  }

  const opened = [
    ...repo.pullRequests.opened.map((p) => {
      const state = p.state === 'open' ? (p.draft ? '<span class="tag t-draft">draft PR</span>' : '<span class="tag t-open">PR</span>') : p.mergedAt ? '<span class="tag t-merged">merged</span>' : '<span class="tag t-closed">closed</span>';
      const reviewers = [...p.requestedReviewers, ...p.requestedTeams];
      return li(
        ref(p, multi),
        `${state}${e(p.title)} <span class="meta">· ${e(p.author)} · +${p.additions}/−${p.deletions}, ${p.changedFiles} files${reviewers.length ? ` · review: ${e(reviewers.join(', '))}` : ''}${p.headRepository ? ` · from ${e(p.headRepository)}` : ''}</span>${excerptHtml(p.bodyExcerpt)}`,
      );
    }),
    ...repo.issues.opened.map((i) =>
      li(
        ref(i, multi),
        `${i.state === 'closed' ? '<span class="tag t-closed">closed</span>' : ''}${e(i.title)} <span class="meta">· ${e(i.author)}${i.labels.length ? ` · ${e(i.labels.join(', '))}` : ''}${i.assignees.length ? ` · → ${e(i.assignees.join(', '))}` : ' · unassigned'}</span>${excerptHtml(i.bodyExcerpt)}`,
      ),
    ),
  ];

  const closed = [
    ...repo.issues.closed.map((i) =>
      li(ref(i, multi), `${e(i.title)} <span class="meta">· closed by ${e(i.closedBy ?? 'unknown')}${i.stateReason && i.stateReason !== 'completed' ? ` (${e(i.stateReason.replace(/_/g, ' '))})` : ''} · opened ${e(day(i.createdAt))}</span>`),
    ),
    ...repo.pullRequests.closedUnmerged.map((p) =>
      li(ref(p, multi), `<span class="tag t-closed">PR not merged</span>${e(p.title)} <span class="meta">· ${e(p.author)}</span>`),
    ),
  ];

  const branchGroups = new Map<number, CommitItem[]>();
  for (const c of repo.commits.pullRequestBranches) branchGroups.set(c.pullRequest!, [...(branchGroups.get(c.pullRequest!) ?? []), c]);
  const progress = [...branchGroups].map(([number, commits]) => {
    const p = [...repo.pullRequests.opened, ...repo.pullRequests.updated, ...repo.pullRequests.closedUnmerged].find((x) => x.number === number);
    return li(
      ref({ repository: repo.name, number, url: p?.url ?? itemUrl(repo.name, number) }, multi),
      `${e(p?.title ?? '')} <span class="meta">· ${commits.length} new commit${commits.length > 1 ? 's' : ''} by ${e([...new Set(commits.map((c) => c.author))].join(', '))}</span>${commitDetails(commits)}`,
    );
  });

  const discussions = repo.discussions.slice(0, 10).map((d) =>
    li(
      ref(d, multi),
      `${e(d.title)} <span class="meta">· ${d.commentCount} comment${d.commentCount > 1 ? 's' : ''} · ${e(d.participants.map((p) => `${p.login} ${p.comments}`).join(', '))}</span>`,
    ),
  );

  const extra: string[] = [];
  if (repo.forks.length) {
    extra.push(`<h3>New forks</h3>${list(repo.forks.map((f) => li(`<span class="ref num meta">${e(day(f.createdAt))}</span>`, `<a href="${e(f.url)}">${e(f.fullName)}</a>`)))}`);
  }
  if (repo.releases.length) {
    extra.push(`<h3>Releases</h3>${list(repo.releases.map((r) => li(`<a class="ref num" href="${e(r.url)}">${e(r.tag)}</a>`, `${e(r.name)} <span class="meta">· ${e(r.author)} · ${e(day(r.publishedAt))}${r.prerelease ? ' · pre-release' : ''}</span>`)))}`);
  }

  return `<h2 id="${anchor(repo.name)}">${multi ? `<a href="${e(repo.url)}">${e(repo.name)}</a>` : 'Numbers'}</h2>
${stats}
<h3>Merged / pushed to ${e(repo.defaultBranch)}</h3>
${list(merged)}
<h3>Opened</h3>
${list(opened)}
<h3>Closed</h3>
${list(closed)}
${progress.length ? `<h3>Progress on open pull requests</h3>${list(progress)}` : ''}
<h3>Discussions</h3>
${list(discussions, 'No human comments in the window.')}
${extra.join('\n')}`;
}

function commitAuthors(commits: CommitItem[]): string {
  const counts = new Map<string, number>();
  for (const c of commits) counts.set(c.author, (counts.get(c.author) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).map(([a, n]) => `${a} ${n}`).join(' · ');
}

function commitDetails(commits: CommitItem[], open = false): string {
  if (!commits.length) return '';
  const items = commits
    .map((c) => `<li><a class="num" href="${e(c.url)}">${e(c.sha.slice(0, 7))}</a> ${e(c.message)} <span class="meta">· ${e(c.author)} · ${e(day(c.date))}</span></li>`)
    .join('');
  return `<details${open ? ' open' : ''}><summary>${commits.length} commit${commits.length > 1 ? 's' : ''}</summary><ul>${items}</ul></details>`;
}

function refs(items: ItemRef[], multi: boolean): string {
  return items.map((i) => `${ref(i, multi, 'num')} ${e(i.title)}`).join('<br>');
}

function contributors(people: Contributor[], multi: boolean): string {
  if (!people.length) return '<p class="empty">No activity.</p>';
  return `<div class="people">${people
    .map((c) => {
      const rows: string[] = [];
      if (multi) rows.push(`<dt>Repositories</dt><dd>${e(c.repositories.join(', '))}</dd>`);
      if (c.commits.length) {
        const viaPr = c.commits.filter((x) => x.pullRequest).length;
        rows.push(
          `<dt>Commits</dt><dd>${c.commits.length}${viaPr ? ` (${viaPr} via pull requests)` : ''}${commitDetails(c.commits)}</dd>`,
        );
      }
      const prs: string[] = [];
      if (c.pullRequestsOpened.length) prs.push(`Opened: ${refs(c.pullRequestsOpened, multi)}`);
      if (c.pullRequestsMerged.length) prs.push(`Merged: ${refs(c.pullRequestsMerged, multi)}`);
      if (c.pullRequestsMergedForOthers.length) prs.push(`Merged for others: ${refs(c.pullRequestsMergedForOthers, multi)}`);
      if (prs.length) rows.push(`<dt>Pull requests</dt><dd>${prs.join('<br>')}</dd>`);
      if (c.reviews.length) {
        rows.push(`<dt>Reviews</dt><dd>${c.reviews.map((r) => `${ref(r, multi, 'num')} ${e(r.state.toLowerCase().replace('_', ' '))}`).join(' · ')}</dd>`);
      }
      const issues: string[] = [];
      if (c.issuesOpened.length) issues.push(`Opened: ${refs(c.issuesOpened, multi)}`);
      if (c.issuesClosed.length) issues.push(`Closed: ${refs(c.issuesClosed, multi)}`);
      if (issues.length) rows.push(`<dt>Issues</dt><dd>${issues.join('<br>')}</dd>`);
      if (c.comments.length) {
        rows.push(`<dt>Comments</dt><dd>${c.comments.map((x) => `${ref(x, multi, 'num')}${x.count > 1 ? ` ×${x.count}` : ''}`).join(' · ')}</dd>`);
      }
      if (c.waitingOn.length) rows.push(`<dt>Expected to act</dt><dd>${c.waitingOn.map((x) => ref(x, multi, 'num')).join(' · ')}</dd>`);
      const name = c.isLogin ? `<a href="https://github.com/${e(c.login)}">${e(c.login)}</a>` : `${e(c.login)} <span class="meta">(git author)</span>`;
      return `<div class="person${c.activity === 0 ? ' idle' : ''}"><h4>${name}</h4>${c.activity === 0 ? '<p class="empty">No activity in the window.</p>' : ''}<dl>${rows.join('')}</dl></div>`;
    })
    .join('')}</div>`;
}

function waiting(items: WaitingItem[], multi: boolean): string {
  if (!items.length) return '<p class="empty">Nothing detected.</p>';
  const counts = new Map<string, number>();
  for (const item of items) for (const u of item.waitingOn) counts.set(u, (counts.get(u) ?? 0) + 1);
  const chips = [...counts]
    .sort((a, b) => b[1] - a[1])
    .map(([u, n]) => `<span class="tag t-wait">${e(u)} ${n}</span>`)
    .join('');
  const rows = items.map((item) => {
    const who = item.waitingOn.length ? item.waitingOn.join(', ') : 'nobody assigned';
    return li(
      ref(item, multi),
      `<span class="tag t-wait">${e(who)}</span>${item.kind === 'pull' ? '<span class="tag t-open">PR</span>' : ''}${e(item.title)} <span class="meta">· since ${e(day(item.since))}</span><div class="excerpt">${item.reasons.map((r) => e(r.detail)).join(' · ')}</div>`,
    );
  });
  return `<div class="chips">${chips}</div>${list(rows)}`;
}
