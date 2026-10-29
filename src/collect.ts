import { computeWaiting, type Activity } from './analyze.js';
import type { GitHubClient } from './github.js';
import type {
  CommentItem,
  CommitItem,
  Discussion,
  IssueItem,
  PullRequestItem,
  RepositoryReport,
  ReviewItem,
  TimeWindow,
  WaitingItem,
} from './model.js';
import { byTime, excerpt, firstLine, inWindow, mentions, ts } from './util.js';

/* eslint-disable @typescript-eslint/no-explicit-any -- raw GitHub API payloads */
type Api = any;

export interface CollectContext {
  gh: GitHubClient;
  window: TimeWindow;
  isIgnored: (login: string | null | undefined, type?: string | null) => boolean;
  log: (message: string) => void;
}

interface PullDetail {
  pull: Api;
  reviews: Api[];
  commits: Api[];
}

export async function collectRepository(
  name: string,
  ctx: CollectContext,
): Promise<{ report: RepositoryReport; waiting: WaitingItem[] }> {
  const { gh, window, isIgnored, log } = ctx;
  const human = (user: Api) => !!user && !isIgnored(user.login, user.type);

  const repo = await gh.get<Api>(`repos/${name}`);
  const branch: string = repo.default_branch;
  log(`${name}: fetching activity since ${window.since}`);

  const sinceTs = ts(window.since);
  const [updated, openPulls, branchCommits, issueComments, reviewComments, forks, releases] = await Promise.all([
    gh.paginate<Api>(`repos/${name}/issues`, { state: 'all', since: window.since, sort: 'updated', direction: 'desc' }),
    gh.paginate<Api>(`repos/${name}/pulls`, { state: 'open' }),
    gh.paginate<Api>(`repos/${name}/commits`, { sha: branch, since: window.since, until: window.until }),
    gh.paginate<Api>(`repos/${name}/issues/comments`, { since: window.since, sort: 'updated', direction: 'asc' }),
    gh.paginate<Api>(`repos/${name}/pulls/comments`, { since: window.since, sort: 'updated', direction: 'asc' }),
    gh.paginate<Api>(`repos/${name}/forks`, { sort: 'newest' }, { stop: (p) => ts(p.at(-1)?.created_at) < sinceTs }),
    gh.paginate<Api>(`repos/${name}/releases`, {}, { stop: (p) => ts(p.at(-1)?.created_at) < sinceTs }),
  ]);

  const byNumber = new Map<number, Api>(updated.map((item: Api) => [item.number, item]));
  const issues = updated.filter((item: Api) => !item.pull_request);
  const pullNumbers = updated.filter((item: Api) => item.pull_request).map((item: Api) => item.number as number);

  // Pull request details: diff stats, merge info, reviews and commits.
  const details = new Map<number, PullDetail>();
  await Promise.all(
    pullNumbers.map(async (number: number) => {
      const [pull, reviews, commits] = await Promise.all([
        gh.get<Api>(`repos/${name}/pulls/${number}`),
        gh.paginate<Api>(`repos/${name}/pulls/${number}/reviews`),
        gh.paginate<Api>(`repos/${name}/pulls/${number}/commits`, {}, { maxPages: 3 }),
      ]);
      details.set(number, { pull, reviews, commits });
    }),
  );

  // closed_by is only returned by the single-issue endpoint.
  const closedBy = new Map<number, string | null>();
  await Promise.all(
    issues
      .filter((issue: Api) => issue.state === 'closed' && inWindow(issue.closed_at, window))
      .map(async (issue: Api) => {
        const full = await gh.get<Api>(`repos/${name}/issues/${issue.number}`);
        closedBy.set(issue.number, full.closed_by?.login ?? null);
      }),
  );

  // ---- Comments and reviews -------------------------------------------------
  interface RawComment extends CommentItem {
    number: number;
  }
  const comments: RawComment[] = [];
  for (const c of issueComments) {
    if (!inWindow(c.created_at, window) || !human(c.user)) continue;
    comments.push(toComment(c, Number(String(c.issue_url).split('/').pop())));
  }
  for (const c of reviewComments) {
    if (!inWindow(c.created_at, window) || !human(c.user)) continue;
    comments.push(toComment(c, Number(String(c.pull_request_url).split('/').pop())));
  }

  const windowReviews = new Map<number, ReviewItem[]>();
  for (const [number, detail] of details) {
    const list = detail.reviews
      .filter((r: Api) => r.state !== 'PENDING' && human(r.user) && inWindow(r.submitted_at, window))
      .map(
        (r: Api): ReviewItem => ({
          author: r.user.login,
          state: r.state,
          submittedAt: r.submitted_at,
          url: r.html_url,
          bodyExcerpt: excerpt(r.body),
        }),
      );
    windowReviews.set(number, list);
  }

  // ---- Commits ---------------------------------------------------------------
  const shaToPull = new Map<string, number>();
  const pullOrder = [...details.values()].sort(
    (a, b) => Number(b.pull.base?.ref === branch) - Number(a.pull.base?.ref === branch),
  );
  for (const { pull, commits } of pullOrder) {
    for (const c of commits) if (!shaToPull.has(c.sha)) shaToPull.set(c.sha, pull.number);
  }
  const messageToPull = new Map<string, number>();
  for (const { pull, commits } of pullOrder) {
    if (!pull.merged_at) continue;
    for (const c of commits) {
      const key = `${commitAuthor(c).author}\u0000${firstLine(c.commit.message)}`;
      if (!messageToPull.has(key)) messageToPull.set(key, pull.number);
    }
  }

  let mergeCommits = 0;
  const defaultBranch: CommitItem[] = [];
  const defaultShas = new Set<string>();
  for (const c of branchCommits) {
    defaultShas.add(c.sha);
    if ((c.parents?.length ?? 0) > 1) {
      mergeCommits++;
      continue;
    }
    const item = toCommit(name, c, null);
    if (!item.authorIsLogin || !isIgnored(item.author)) {
      const suffix = /\(#(\d+)\)\s*$/.exec(item.message);
      item.pullRequest =
        shaToPull.get(c.sha) ??
        (suffix ? Number(suffix[1]) : undefined) ??
        messageToPull.get(`${item.author}\u0000${item.message}`) ??
        null;
      defaultBranch.push(item);
    }
  }
  defaultBranch.sort(byTime((c) => c.date));

  // Branch commits of merged pull requests are represented by what reached the default branch.
  const pullRequestBranches: CommitItem[] = [];
  for (const { pull, commits } of details.values()) {
    if (pull.merged_at) continue;
    for (const c of commits) {
      if (defaultShas.has(c.sha) || (c.parents?.length ?? 0) > 1) continue;
      if (!inWindow(c.commit?.committer?.date, window)) continue;
      const item = toCommit(name, c, pull.number);
      if (item.authorIsLogin && isIgnored(item.author)) continue;
      pullRequestBranches.push(item);
    }
  }
  pullRequestBranches.sort(byTime((c) => c.date));

  // ---- Issues ----------------------------------------------------------------
  const toIssue = (i: Api): IssueItem => ({
    repository: name,
    number: i.number,
    title: i.title,
    url: i.html_url,
    author: i.user?.login ?? 'ghost',
    state: i.state,
    stateReason: i.state_reason ?? null,
    createdAt: i.created_at,
    closedAt: i.closed_at ?? null,
    closedBy: closedBy.get(i.number) ?? null,
    labels: (i.labels ?? []).map((l: Api) => (typeof l === 'string' ? l : l.name)),
    assignees: (i.assignees ?? []).map((a: Api) => a.login),
    commentCount: i.comments ?? 0,
    bodyExcerpt: excerpt(i.body),
  });
  const issuesOpened = issues.filter((i: Api) => inWindow(i.created_at, window)).map(toIssue);
  const issuesClosed = issues.filter((i: Api) => i.state === 'closed' && inWindow(i.closed_at, window)).map(toIssue);

  // ---- Pull requests ---------------------------------------------------------
  const toPull = (number: number): PullRequestItem => {
    const p = details.get(number)!.pull;
    const head = p.head?.repo?.full_name ?? null;
    return {
      repository: name,
      number,
      title: p.title,
      url: p.html_url,
      author: p.user?.login ?? 'ghost',
      state: p.state,
      draft: !!p.draft,
      createdAt: p.created_at,
      closedAt: p.closed_at ?? null,
      mergedAt: p.merged_at ?? null,
      mergedBy: p.merged_by?.login ?? null,
      baseRef: p.base?.ref ?? '',
      headRef: p.head?.ref ?? '',
      headRepository: head && head !== name ? head : null,
      additions: p.additions ?? 0,
      deletions: p.deletions ?? 0,
      changedFiles: p.changed_files ?? 0,
      labels: (p.labels ?? []).map((l: Api) => l.name),
      assignees: (p.assignees ?? []).map((a: Api) => a.login),
      requestedReviewers: (p.requested_reviewers ?? []).map((u: Api) => u.login),
      requestedTeams: (p.requested_teams ?? []).map((t: Api) => `${name.split('/')[0]}/${t.slug}`),
      reviews: windowReviews.get(number) ?? [],
      bodyExcerpt: excerpt(p.body),
    };
  };
  const pulls = [...details.keys()].sort((a, b) => a - b).map(toPull);
  const commentedNumbers = new Set(comments.map((c) => c.number));
  const branchCommitNumbers = new Set(pullRequestBranches.map((c) => c.pullRequest));
  const pullsOpened = pulls.filter((p) => inWindow(p.createdAt, window));
  const pullsMerged = pulls.filter((p) => inWindow(p.mergedAt, window));
  const pullsClosedUnmerged = pulls.filter((p) => !p.mergedAt && p.state === 'closed' && inWindow(p.closedAt, window));
  const pullsUpdated = pulls.filter(
    (p) =>
      p.state === 'open' &&
      !inWindow(p.createdAt, window) &&
      (commentedNumbers.has(p.number) || p.reviews.length > 0 || branchCommitNumbers.has(p.number)),
  );

  // ---- Discussions -------------------------------------------------------------
  const discussionComments = new Map<number, CommentItem[]>();
  for (const c of comments) discussionComments.set(c.number, [...(discussionComments.get(c.number) ?? []), c]);
  for (const [number, reviews] of windowReviews) {
    for (const r of reviews) {
      if (!r.bodyExcerpt) continue;
      const raw = details.get(number)!.reviews.find((x: Api) => x.html_url === r.url);
      discussionComments.set(number, [
        ...(discussionComments.get(number) ?? []),
        { author: r.author, createdAt: r.submittedAt, url: r.url, bodyExcerpt: r.bodyExcerpt, mentions: mentions(raw?.body) },
      ]);
    }
  }
  const discussions: Discussion[] = [];
  for (const [number, list] of discussionComments) {
    const item = byNumber.get(number);
    if (!item) continue;
    list.sort(byTime((c) => c.createdAt));
    const counts = new Map<string, number>();
    for (const c of list) counts.set(c.author, (counts.get(c.author) ?? 0) + 1);
    discussions.push({
      repository: name,
      number,
      kind: item.pull_request ? 'pull' : 'issue',
      title: item.title,
      url: item.html_url,
      state: item.state,
      commentCount: list.length,
      participants: [...counts].map(([login, n]) => ({ login, comments: n })).sort((a, b) => b.comments - a.comments),
      recentComments: list.slice(-5).map(({ author, createdAt, url, bodyExcerpt, mentions: m }) => ({
        author,
        createdAt,
        url,
        bodyExcerpt,
        mentions: m,
      })),
    });
  }
  discussions.sort((a, b) => b.commentCount - a.commentCount || b.number - a.number);

  // ---- Waiting -------------------------------------------------------------------
  const waiting: WaitingItem[] = [];
  const activityFor = (number: number): Activity[] => {
    const list: Activity[] = (discussionComments.get(number) ?? [])
      .filter((c) => !c.url.includes('#pullrequestreview-'))
      .map((c) => ({ type: 'comment', actor: c.author, at: c.createdAt, mentions: c.mentions }));
    const detail = details.get(number);
    if (detail) {
      for (const r of detail.reviews) {
        if (r.state === 'PENDING' || !human(r.user) || ts(r.submitted_at) >= ts(window.until)) continue;
        list.push({ type: 'review', actor: r.user.login, at: r.submitted_at, reviewState: r.state, mentions: mentions(r.body) });
      }
      for (const c of detail.commits) {
        const author = commitAuthor(c);
        const at = c.commit?.committer?.date;
        if (!author.isLogin || ts(at) >= ts(window.until)) continue;
        list.push({ type: 'commit', actor: author.author, at });
      }
    }
    return list;
  };

  for (const i of issues) {
    if (i.state !== 'open') continue;
    const opened = inWindow(i.created_at, window);
    if (!opened && !commentedNumbers.has(i.number)) continue;
    const item = computeWaiting({
      repository: name,
      number: i.number,
      kind: 'issue',
      title: i.title,
      url: i.html_url,
      draft: false,
      author: i.user?.login ?? 'ghost',
      createdAt: i.created_at,
      assignees: (i.assignees ?? []).map((a: Api) => a.login),
      requestedReviewers: [],
      requestedTeams: [],
      activity: activityFor(i.number),
    });
    if (item) waiting.push(item);
  }
  for (const p of pulls) {
    if (p.state !== 'open') continue;
    const active =
      inWindow(p.createdAt, window) ||
      commentedNumbers.has(p.number) ||
      p.reviews.length > 0 ||
      branchCommitNumbers.has(p.number) ||
      p.requestedReviewers.length + p.requestedTeams.length > 0;
    if (!active) continue;
    const item = computeWaiting({ ...p, kind: 'pull', activity: activityFor(p.number) });
    if (item) waiting.push(item);
  }
  // Review requests that have been sitting without any activity in the window.
  for (const p of openPulls) {
    if (details.has(p.number) || p.draft) continue;
    const reviewers = (p.requested_reviewers ?? []).map((u: Api) => u.login);
    const teams = (p.requested_teams ?? []).map((t: Api) => `${name.split('/')[0]}/${t.slug}`);
    if (!reviewers.length && !teams.length) continue;
    const item = computeWaiting({
      repository: name,
      number: p.number,
      kind: 'pull',
      title: p.title,
      url: p.html_url,
      draft: false,
      author: p.user?.login ?? 'ghost',
      createdAt: p.created_at,
      assignees: [],
      requestedReviewers: reviewers,
      requestedTeams: teams,
      activity: [],
    });
    if (item) waiting.push(item);
  }
  waiting.sort(byTime((w) => w.since));

  // ---- Forks and releases ----------------------------------------------------------
  const newForks = forks
    .filter((f: Api) => inWindow(f.created_at, window))
    .map((f: Api) => ({ fullName: f.full_name, url: f.html_url, owner: f.owner?.login ?? '', createdAt: f.created_at }));
  const newReleases = releases
    .filter((r: Api) => !r.draft && inWindow(r.published_at, window))
    .map((r: Api) => ({
      tag: r.tag_name,
      name: r.name || r.tag_name,
      url: r.html_url,
      author: r.author?.login ?? '',
      publishedAt: r.published_at,
      prerelease: !!r.prerelease,
    }));

  const reviewCount = [...windowReviews.values()].reduce((sum, list) => sum + list.length, 0);

  const report: RepositoryReport = {
    name,
    url: repo.html_url,
    defaultBranch: branch,
    totals: {
      stars: repo.stargazers_count ?? 0,
      forks: repo.forks_count ?? 0,
      watchers: repo.subscribers_count ?? 0,
      // open_issues_count includes pull requests.
      openIssues: Math.max(0, (repo.open_issues_count ?? 0) - openPulls.length),
      openPullRequests: openPulls.length,
    },
    numbers: {
      issuesOpened: issuesOpened.length,
      issuesClosed: issuesClosed.length,
      pullRequestsOpened: pullsOpened.length,
      pullRequestsMerged: pullsMerged.length,
      pullRequestsClosedUnmerged: pullsClosedUnmerged.length,
      defaultBranchCommits: defaultBranch.length,
      pullRequestBranchCommits: pullRequestBranches.length,
      mergeCommits,
      comments: comments.length,
      reviews: reviewCount,
      newForks: newForks.length,
      releases: newReleases.length,
    },
    issues: { opened: issuesOpened, closed: issuesClosed },
    pullRequests: {
      opened: pullsOpened,
      merged: pullsMerged,
      closedUnmerged: pullsClosedUnmerged,
      updated: pullsUpdated,
    },
    commits: { defaultBranch, pullRequestBranches },
    discussions,
    forks: newForks,
    releases: newReleases,
  };
  return { report, waiting };
}

function toComment(c: Api, number: number): CommentItem & { number: number } {
  return {
    number,
    author: c.user.login,
    createdAt: c.created_at,
    url: c.html_url,
    bodyExcerpt: excerpt(c.body),
    mentions: mentions(c.body),
  };
}

function commitAuthor(c: Api): { author: string; isLogin: boolean } {
  if (c.author?.login) return { author: c.author.login, isLogin: true };
  return { author: c.commit?.author?.name ?? 'unknown', isLogin: false };
}

function toCommit(repository: string, c: Api, pullRequest: number | null): CommitItem {
  const { author, isLogin } = commitAuthor(c);
  return {
    repository,
    sha: c.sha,
    url: c.html_url,
    author,
    authorIsLogin: isLogin,
    date: c.commit?.committer?.date ?? c.commit?.author?.date,
    message: firstLine(c.commit?.message ?? ''),
    pullRequest,
  };
}
