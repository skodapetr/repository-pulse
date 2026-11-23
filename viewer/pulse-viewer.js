/**
 * Repository Pulse viewer.
 *
 * Renders a pulse report in the browser. It reads `manifest.json` (the address
 * comes from <meta name="pulse-manifest">, default "manifest.json" next to the
 * page), shows the report named in the URL hash (#2026-11-14, default: the
 * latest) and fetches the report's pulse.json. Formats: documentation/manifest.md
 * and documentation/json-output.md.
 *
 * This is one dependency-free file. To change how reports look, copy it, edit
 * it and point the action's `viewer` input at your copy (a path, or an https
 * URL where you host it). All text from reports is put into the page with
 * textContent, never as HTML; keep it that way when you edit.
 */

/** @typedef {import('../src/model.js').Report} Report */
/** @typedef {import('../src/model.js').Manifest} Manifest */
/** @typedef {import('../src/model.js').ManifestEntry} ManifestEntry */
/** @typedef {import('../src/model.js').RepositoryReport} RepositoryReport */
/** @typedef {import('../src/model.js').CommitItem} CommitItem */
/** @typedef {import('../src/model.js').ItemRef} ItemRef */
/** @typedef {import('../src/model.js').Contributor} Contributor */
/** @typedef {import('../src/model.js').WaitingItem} WaitingItem */
/** @typedef {string | number | Node | null | undefined | false | Child[]} Child */

export const SUPPORTED_MANIFEST_VERSION = 1;
export const SUPPORTED_REPORT_VERSION = 1;

// ---------------------------------------------------------------------------
// Pure helpers (no DOM), covered by tests.
// ---------------------------------------------------------------------------

const DATE_HASH = /^#?(\d{4}-\d{2}-\d{2})$/;

/** The report date asked for by the URL hash, null when the hash does not name one. */
export function dateFromHash(hash) {
  const match = DATE_HASH.exec(hash || '');
  return match ? match[1] : null;
}

/**
 * Which report to show and its neighbours. `date` null means the latest.
 * @param {Manifest} manifest
 * @param {string | null} date
 */
export function locate(manifest, date) {
  const reports = manifest.reports;
  const index = date === null ? 0 : reports.findIndex((r) => r.date === date);
  if (index < 0) return null;
  return {
    entry: reports[index],
    // Reports are newest first: the previous report is the next one in the list.
    previous: reports[index + 1] ?? null,
    next: index > 0 ? reports[index - 1] : null,
  };
}

/** Only https links, in-page and relative references are put into href. */
export function safeUrl(url) {
  const value = String(url ?? '');
  if (/^https:\/\//i.test(value)) return value;
  if (value.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(value)) return '#';
  return value;
}

/** "2026-10-22 – 2026-10-28": the last day is the one before the exclusive end. */
export function formatRange(window) {
  const day = (ms) => new Date(ms).toISOString().slice(0, 10);
  return `${window.since.slice(0, 10)} – ${day(Date.parse(window.until) - 1)}`;
}

export function refLabel(item, multi) {
  return multi ? `${item.repository.split('/')[1]}#${item.number}` : `#${item.number}`;
}

export function anchorId(name) {
  return 'repo-' + name.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase();
}

export function itemUrl(repo, number) {
  return `https://github.com/${repo}/issues/${number}`;
}

/** @param {CommitItem[]} commits */
export function commitAuthors(commits) {
  const counts = new Map();
  for (const c of commits) counts.set(c.author, (counts.get(c.author) ?? 0) + 1);
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .map(([a, n]) => `${a} ${n}`)
    .join(' · ');
}

/** Commits on the default branch that are not part of a listed merged pull request, grouped by pull request or author. */
export function directCommitGroups(repo) {
  const merged = new Set(repo.pullRequests.merged.map((p) => p.number));
  const groups = new Map();
  for (const c of repo.commits.defaultBranch) {
    if (c.pullRequest && merged.has(c.pullRequest)) continue;
    const key = c.pullRequest ? `#${c.pullRequest}` : c.author;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  return [...groups];
}

/** Commits on open pull request branches, grouped by pull request number. */
export function branchGroups(repo) {
  const groups = new Map();
  for (const c of repo.commits.pullRequestBranches) groups.set(c.pullRequest, [...(groups.get(c.pullRequest) ?? []), c]);
  return [...groups];
}

export function waitingCounts(items) {
  const counts = new Map();
  for (const item of items) for (const user of item.waitingOn) counts.set(user, (counts.get(user) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]);
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// ---------------------------------------------------------------------------
// DOM building. Everything goes through h(), which only creates text nodes.
// ---------------------------------------------------------------------------

/**
 * @param {string} tag
 * @param {Record<string, string | number | boolean | null | undefined> | null} [props]
 * @param {...Child} children
 * @returns {HTMLElement}
 */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') el.className = String(value);
    else if (key === 'href') el.setAttribute('href', safeUrl(value));
    else el.setAttribute(key, String(value));
  }
  append(el, children);
  return el;
}

/** @param {Node} parent @param {Child[]} children */
function append(parent, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(parent, child);
    else if (child instanceof Node) parent.appendChild(child);
    else parent.appendChild(document.createTextNode(String(child)));
  }
}

const li = (refNode, ...body) => h('li', null, refNode, h('div', { class: 'body' }, body));
const list = (items, emptyText = 'None.') => (items.length ? h('ul', { class: 'list' }, items) : h('p', { class: 'empty' }, emptyText));
const tag = (cls, text) => h('span', { class: `tag ${cls}` }, text);
const meta = (...children) => h('span', { class: 'meta' }, children);
const excerptNode = (text) => (text ? h('div', { class: 'excerpt' }, text.length > 220 ? text.slice(0, 219) + '…' : text) : null);
const day = (value) => (value ? value.slice(0, 10) : '');

/** @param {{ repository: string, number: number, url: string }} item */
function refLink(item, multi, cls = 'ref num') {
  return h('a', { class: cls, href: item.url }, refLabel(item, multi));
}

/** In-page link that scrolls instead of touching the hash, which selects the report. */
function jump(id, text) {
  const a = h('a', { href: '#' }, text);
  a.addEventListener('click', (event) => {
    event.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  });
  return a;
}

/** @param {CommitItem[]} commits */
function commitDetails(commits, open = false) {
  if (!commits.length) return null;
  const items = commits.map((c) =>
    h('li', null, h('a', { class: 'num', href: c.url }, c.sha.slice(0, 7)), ` ${c.message} `, meta(`· ${c.author} · ${day(c.date)}`)),
  );
  return h('details', { open }, h('summary', null, plural(commits.length, 'commit')), h('ul', null, items));
}

/** @param {Report} report */
export function renderReport(report) {
  const multi = report.repositories.length > 1;
  const w = report.window;
  return h(
    'div',
    null,
    h(
      'header',
      null,
      h('p', { class: 'num meta' }, `${w.since} → ${w.until} (${w.days} days, UTC)`),
      h('p', null, report.repositories.flatMap((r, i) => [i ? ' · ' : null, h('a', { href: r.url }, r.name)])),
    ),
    multi ? overview(report) : null,
    report.repositories.map((r) => repositorySection(r, multi)),
    h('h2', { id: 'contributors' }, 'Contributors'),
    contributors(report.contributors, multi),
    h('h2', { id: 'waiting' }, 'Waiting on someone'),
    waiting(report.waiting, multi),
    h(
      'footer',
      null,
      `Generated ${report.generatedAt} by ${report.generator.name} ${report.generator.version} from the GitHub API. ` +
        'Totals are at generation time; everything else is limited to the window. ' +
        `Excluded as bots: ${report.ignoredUsers.join(', ') || 'none'}. ` +
        '“Waiting on” is derived by rules from the latest activity.',
    ),
  );
}

/** @param {Report} report */
function overview(report) {
  const head = ['Repository', 'Issues +/−', 'PRs + / merged', 'Commits', 'PR-branch', 'Comments', 'Reviews', 'Open issues', 'Open PRs', 'Forks'];
  const rows = report.repositories.map((r) => {
    const n = r.numbers;
    return h(
      'tr',
      null,
      h('td', null, jump(anchorId(r.name), r.name)),
      [
        `+${n.issuesOpened} / −${n.issuesClosed}`,
        `+${n.pullRequestsOpened} / ${n.pullRequestsMerged}`,
        n.defaultBranchCommits,
        n.pullRequestBranchCommits,
        n.comments,
        n.reviews,
        r.totals.openIssues,
        r.totals.openPullRequests,
        n.newForks,
      ].map((v) => h('td', null, v)),
    );
  });
  return [
    h('h2', null, 'Overview'),
    h('div', { class: 'scroll' }, h('table', null, h('thead', null, h('tr', null, head.map((t) => h('th', null, t)))), h('tbody', null, rows))),
  ];
}

const stat = (value, label, detail) =>
  h('div', { class: 'stat' }, h('div', { class: 'v' }, value), h('div', { class: 'l' }, label), h('div', { class: 'd' }, detail));

/** @param {RepositoryReport} repo */
function repositorySection(repo, multi) {
  const n = repo.numbers;
  const t = repo.totals;
  const stats = h(
    'div',
    { class: 'stats' },
    stat(`+${n.issuesOpened} / −${n.issuesClosed}`, 'Issues opened / closed', `${t.openIssues} open`),
    stat(
      `+${n.pullRequestsOpened} / ${n.pullRequestsMerged}`,
      'PRs opened / merged',
      `${t.openPullRequests} open${n.pullRequestsClosedUnmerged ? ` · ${n.pullRequestsClosedUnmerged} closed unmerged` : ''}`,
    ),
    stat(n.defaultBranchCommits, `Commits on ${repo.defaultBranch}`, commitAuthors(repo.commits.defaultBranch) || '—'),
    stat(`${n.comments} / ${n.reviews}`, 'Comments / reviews', `${n.pullRequestBranchCommits} commits on PR branches`),
    stat(n.newForks, 'New forks', `${t.forks} total · ${t.stars} stars`),
  );

  const merged = repo.pullRequests.merged.map((p) =>
    li(
      refLink(p, multi),
      tag('t-merged', 'merged'),
      p.title,
      ' ',
      meta(
        `· ${p.author} · into `,
        h('code', null, p.baseRef),
        ` · +${p.additions}/−${p.deletions}, ${p.changedFiles} files${p.mergedBy && p.mergedBy !== p.author ? ` · merged by ${p.mergedBy}` : ''}`,
      ),
      commitDetails(repo.commits.defaultBranch.filter((c) => c.pullRequest === p.number)),
    ),
  );
  for (const [key, commits] of directCommitGroups(repo)) {
    const label = key.startsWith('#')
      ? [`${plural(commits.length, 'commit')} from `, h('a', { href: itemUrl(repo.name, Number(key.slice(1))) }, key)]
      : `${plural(commits.length, 'direct commit')} by ${key}`;
    merged.push(li(h('span', { class: 'ref num meta' }, 'direct'), label, commitDetails(commits, true)));
  }

  const opened = [
    ...repo.pullRequests.opened.map((p) => {
      const state =
        p.state === 'open'
          ? p.draft
            ? tag('t-draft', 'draft PR')
            : tag('t-open', 'PR')
          : p.mergedAt
            ? tag('t-merged', 'merged')
            : tag('t-closed', 'closed');
      const reviewers = [...p.requestedReviewers, ...p.requestedTeams];
      return li(
        refLink(p, multi),
        state,
        p.title,
        ' ',
        meta(
          `· ${p.author} · +${p.additions}/−${p.deletions}, ${p.changedFiles} files${reviewers.length ? ` · review: ${reviewers.join(', ')}` : ''}${p.headRepository ? ` · from ${p.headRepository}` : ''}`,
        ),
        excerptNode(p.bodyExcerpt),
      );
    }),
    ...repo.issues.opened.map((i) =>
      li(
        refLink(i, multi),
        i.state === 'closed' ? tag('t-closed', 'closed') : null,
        i.title,
        ' ',
        meta(`· ${i.author}${i.labels.length ? ` · ${i.labels.join(', ')}` : ''}${i.assignees.length ? ` · → ${i.assignees.join(', ')}` : ' · unassigned'}`),
        excerptNode(i.bodyExcerpt),
      ),
    ),
  ];

  const closed = [
    ...repo.issues.closed.map((i) =>
      li(
        refLink(i, multi),
        i.title,
        ' ',
        meta(
          `· closed by ${i.closedBy ?? 'unknown'}${i.stateReason && i.stateReason !== 'completed' ? ` (${i.stateReason.replace(/_/g, ' ')})` : ''} · opened ${day(i.createdAt)}`,
        ),
      ),
    ),
    ...repo.pullRequests.closedUnmerged.map((p) => li(refLink(p, multi), tag('t-closed', 'PR not merged'), p.title, ' ', meta(`· ${p.author}`))),
  ];

  const known = [...repo.pullRequests.opened, ...repo.pullRequests.updated, ...repo.pullRequests.closedUnmerged];
  const progress = branchGroups(repo).map(([number, commits]) => {
    const p = known.find((x) => x.number === number);
    const authors = [...new Set(commits.map((c) => c.author))].join(', ');
    return li(
      refLink({ repository: repo.name, number, url: p?.url ?? itemUrl(repo.name, number) }, multi),
      p?.title ?? '',
      ' ',
      meta(`· ${commits.length} new commit${commits.length > 1 ? 's' : ''} by ${authors}`),
      commitDetails(commits),
    );
  });

  const discussions = repo.discussions
    .slice(0, 10)
    .map((d) =>
      li(
        refLink(d, multi),
        d.title,
        ' ',
        meta(`· ${plural(d.commentCount, 'comment')} · ${d.participants.map((p) => `${p.login} ${p.comments}`).join(', ')}`),
      ),
    );

  const extra = [];
  if (repo.forks.length) {
    extra.push(
      h('h3', null, 'New forks'),
      list(repo.forks.map((f) => li(h('span', { class: 'ref num meta' }, day(f.createdAt)), h('a', { href: f.url }, f.fullName)))),
    );
  }
  if (repo.releases.length) {
    extra.push(
      h('h3', null, 'Releases'),
      list(
        repo.releases.map((r) =>
          li(h('a', { class: 'ref num', href: r.url }, r.tag), r.name, ' ', meta(`· ${r.author} · ${day(r.publishedAt)}${r.prerelease ? ' · pre-release' : ''}`)),
        ),
      ),
    );
  }

  return [
    h('h2', { id: anchorId(repo.name) }, multi ? h('a', { href: repo.url }, repo.name) : 'Numbers'),
    stats,
    h('h3', null, `Merged / pushed to ${repo.defaultBranch}`),
    list(merged),
    h('h3', null, 'Opened'),
    list(opened),
    h('h3', null, 'Closed'),
    list(closed),
    progress.length ? [h('h3', null, 'Progress on open pull requests'), list(progress)] : null,
    h('h3', null, 'Discussions'),
    list(discussions, 'No human comments in the window.'),
    extra,
  ];
}

/** @param {ItemRef[]} items */
const refs = (items, multi) => items.flatMap((i, n) => [n ? h('br') : null, refLink(i, multi, 'num'), ` ${i.title}`]);

/** @param {Contributor[]} people */
function contributors(people, multi) {
  if (!people.length) return h('p', { class: 'empty' }, 'No activity.');
  return h(
    'div',
    { class: 'people' },
    people.map((c) => {
      const rows = [];
      const row = (term, ...value) => rows.push(h('dt', null, term), h('dd', null, value));
      if (multi) row('Repositories', c.repositories.join(', '));
      if (c.commits.length) {
        const viaPr = c.commits.filter((x) => x.pullRequest).length;
        row('Commits', `${c.commits.length}${viaPr ? ` (${viaPr} via pull requests)` : ''}`, commitDetails(c.commits));
      }
      const prs = [];
      const group = (label, items) => items.length && prs.push(prs.length ? h('br') : null, `${label}: `, refs(items, multi));
      group('Opened', c.pullRequestsOpened);
      group('Merged', c.pullRequestsMerged);
      group('Merged for others', c.pullRequestsMergedForOthers);
      if (prs.length) row('Pull requests', prs);
      if (c.reviews.length) {
        row('Reviews', c.reviews.flatMap((r, i) => [i ? ' · ' : null, refLink(r, multi, 'num'), ` ${r.state.toLowerCase().replace('_', ' ')}`]));
      }
      const issues = [];
      const issueGroup = (label, items) => items.length && issues.push(issues.length ? h('br') : null, `${label}: `, refs(items, multi));
      issueGroup('Opened', c.issuesOpened);
      issueGroup('Closed', c.issuesClosed);
      if (issues.length) row('Issues', issues);
      if (c.comments.length) {
        row('Comments', c.comments.flatMap((x, i) => [i ? ' · ' : null, refLink(x, multi, 'num'), x.count > 1 ? ` ×${x.count}` : null]));
      }
      if (c.waitingOn.length) row('Expected to act', c.waitingOn.flatMap((x, i) => [i ? ' · ' : null, refLink(x, multi, 'num')]));
      const name = c.isLogin ? h('a', { href: `https://github.com/${encodeURIComponent(c.login)}` }, c.login) : [c.login, ' ', meta('(git author)')];
      return h(
        'div',
        { class: `person${c.activity === 0 ? ' idle' : ''}` },
        h('h4', null, name),
        c.activity === 0 ? h('p', { class: 'empty' }, 'No activity in the window.') : null,
        h('dl', null, rows),
      );
    }),
  );
}

/** @param {WaitingItem[]} items */
function waiting(items, multi) {
  if (!items.length) return h('p', { class: 'empty' }, 'Nothing detected.');
  const chips = waitingCounts(items).map(([user, n]) => tag('t-wait', `${user} ${n}`));
  const rows = items.map((item) =>
    li(
      refLink(item, multi),
      tag('t-wait', item.waitingOn.length ? item.waitingOn.join(', ') : 'nobody assigned'),
      item.kind === 'pull' ? tag('t-open', 'PR') : null,
      item.title,
      ' ',
      meta(`· since ${day(item.since)}`),
      h('div', { class: 'excerpt' }, item.reasons.map((r) => r.detail).join(' · ')),
    ),
  );
  return [h('div', { class: 'chips' }, chips), list(rows)];
}

// ---------------------------------------------------------------------------
// Page: loading, navigation, errors.
// ---------------------------------------------------------------------------

const STYLE = `
:root{--bg:#fafaf9;--surface:#fff;--text:#1c1917;--muted:#6b6560;--line:#e7e5e4;--accent:#2457c5;--accent-soft:#e8eefb;
--ok:#1f7a4d;--ok-soft:#e5f3eb;--warn:#a15c07;--warn-soft:#fbf0de;--bad:#b42318;--bad-soft:#fdecea;
--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;--sans:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
@media (prefers-color-scheme:dark){:root{--bg:#141312;--surface:#1d1c1a;--text:#ece9e6;--muted:#a19c96;--line:#2f2d2a;
--accent:#7fa6f5;--accent-soft:#1c2740;--ok:#6cc79a;--ok-soft:#16291f;--warn:#e4a64e;--warn-soft:#2e2414;--bad:#f08a80;--bad-soft:#331a17}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.55 var(--sans)}
main{max-width:920px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:26px;margin:16px 0 4px;letter-spacing:-.01em}
header p{margin:2px 0;color:var(--muted)}
h2{font-size:20px;margin:44px 0 12px;padding-top:8px;border-top:1px solid var(--line)}
h3{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:26px 0 10px;font-weight:600}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
code{font:13px var(--mono);background:var(--accent-soft);padding:1px 5px;border-radius:4px}
.num{font-family:var(--mono);font-size:13px}
.muted{color:var(--muted)}
.nav{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;justify-content:space-between;padding:8px 12px;background:var(--surface);border:1px solid var(--line);border-radius:8px;font-size:14px}
.nav .group{display:flex;gap:12px;align-items:center}
.nav .off{color:var(--muted)}
.nav select{font:inherit;color:var(--text);background:var(--bg);border:1px solid var(--line);border-radius:6px;padding:2px 6px}
.notice{margin:16px 0;padding:10px 14px;border-radius:8px;background:var(--warn-soft);color:var(--warn)}
.error{background:var(--bad-soft);color:var(--bad)}
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

async function getJson(url) {
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`${url} answered HTTP ${response.status}`);
  return response.json();
}

/** Previous / date list / next, and links to the raw files of the shown report. */
function navigation(manifest, located, manifestUrl) {
  const { entry, previous, next } = located;
  const step = (target, label) =>
    target ? h('a', { href: `#${target.date}` }, label(target.date)) : h('span', { class: 'off' }, label(null));
  const select = /** @type {HTMLSelectElement} */ (
    h('select', { 'aria-label': 'Report date' }, manifest.reports.map((r) => h('option', { value: r.date, selected: r.date === entry.date }, r.date)))
  );
  select.addEventListener('change', () => {
    location.hash = select.value;
  });
  const raw = [];
  if (entry.files.json) raw.push(h('a', { href: new URL(entry.files.json, manifestUrl).href }, 'JSON'));
  if (entry.files.markdown) raw.push(h('a', { href: new URL(entry.files.markdown, manifestUrl).href }, 'Markdown'));
  return h(
    'nav',
    { class: 'nav' },
    h('div', { class: 'group' }, step(previous, (d) => `← ${d ?? 'older'}`), select, step(next, (d) => `${d ?? 'newer'} →`)),
    h('div', { class: 'group' }, raw.flatMap((a, i) => [i ? ' · ' : null, a])),
  );
}

/** Start the viewer in the page. Exported for tests that run it against a fake page. */
export async function main() {
  const styleElement = document.createElement('style');
  styleElement.textContent = STYLE;
  document.head.appendChild(styleElement);
  const root = h('main');
  document.body.replaceChildren(root);

  const configured = document.querySelector('meta[name="pulse-manifest"]')?.getAttribute('content') || 'manifest.json';
  const manifestUrl = new URL(configured, document.baseURI);
  const show = (...children) => root.replaceChildren(...children.flat().filter(Boolean));
  const fail = (message, ...rest) => show(h('h1', null, 'Repository pulse'), h('div', { class: 'notice error' }, message), rest);

  show(h('p', { class: 'muted' }, 'Loading…'));
  /** @type {Manifest} */
  let manifest;
  try {
    manifest = await getJson(manifestUrl);
  } catch (error) {
    return fail(`Could not load the manifest. ${error.message}`);
  }
  if (!manifest || !Array.isArray(manifest.reports) || manifest.schemaVersion !== SUPPORTED_MANIFEST_VERSION) {
    return fail(`The manifest has an unsupported format (schemaVersion ${manifest?.schemaVersion}); this viewer reads ${SUPPORTED_MANIFEST_VERSION}.`);
  }
  if (!manifest.reports.length) return fail('The manifest lists no reports yet.');

  let token = 0;
  const render = async () => {
    const mine = ++token;
    const date = dateFromHash(location.hash);
    const located = locate(manifest, date);
    if (!located) {
      const latest = manifest.reports[0].date;
      return fail(`There is no report for ${date}.`, h('p', null, h('a', { href: `#${latest}` }, `Open the latest report (${latest})`)));
    }
    const { entry } = located;
    document.title = `${entry.title} · ${formatRange(entry.window)}`;
    const nav = navigation(manifest, located, manifestUrl);
    const heading = h('h1', null, entry.title);
    if (!entry.files.json) return show(nav, heading, h('div', { class: 'notice' }, 'This report has no JSON file, so there is nothing to display. Use the Markdown link.'));
    show(nav, heading, h('p', { class: 'muted' }, 'Loading…'));
    let report;
    try {
      report = await getJson(new URL(entry.files.json, manifestUrl));
    } catch (error) {
      if (mine === token) show(nav, heading, h('div', { class: 'notice error' }, `Could not load the report. ${error.message}`));
      return;
    }
    if (mine !== token) return; // The reader moved on while this was loading.
    const warning =
      report.schemaVersion > SUPPORTED_REPORT_VERSION
        ? h('div', { class: 'notice' }, `This report uses schemaVersion ${report.schemaVersion}, newer than this viewer knows (${SUPPORTED_REPORT_VERSION}). Some data may be missing.`)
        : null;
    show(nav, heading, warning, renderReport(report));
    window.scrollTo(0, 0);
  };
  window.addEventListener('hashchange', () => {
    // Other hashes (a plain "#") are not report selections.
    if (location.hash === '' || dateFromHash(location.hash)) void render();
  });
  await render();
}

if (typeof document !== 'undefined' && document.body) void main();
