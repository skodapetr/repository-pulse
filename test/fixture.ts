import { buildContributors } from '../src/analyze.js';
import { SCHEMA_VERSION, type CommitItem, type Report, type RepositoryReport, type WaitingItem } from '../src/model.js';

/** A small but complete report whose window ends on `until` (YYYY-MM-DD). */
export function sampleReport(until: string, repoNames = ['o/alpha', 'o/beta']): Report {
  const end = Date.parse(`${until}T00:00:00Z`);
  const window = { since: new Date(end - 7 * 86_400_000).toISOString().replace('.000', ''), until: `${until}T00:00:00Z`, days: 7 };
  const at = new Date(end - 86_400_000).toISOString().replace('.000', '');
  const commit = (repo: string, sha: string, pullRequest: number | null): CommitItem => ({
    repository: repo,
    sha,
    url: `https://github.com/${repo}/commit/${sha}`,
    author: 'alice',
    authorIsLogin: true,
    date: at,
    message: `Change <b>${sha}</b>`,
    pullRequest,
  });
  const repositories: RepositoryReport[] = repoNames.map((name, i) => ({
    name,
    url: `https://github.com/${name}`,
    defaultBranch: 'main',
    totals: { stars: 5, forks: 1, watchers: 2, openIssues: 3, openPullRequests: 1 },
    numbers: {
      issuesOpened: 1,
      issuesClosed: 0,
      pullRequestsOpened: 0,
      pullRequestsMerged: 1,
      pullRequestsClosedUnmerged: 0,
      defaultBranchCommits: 2,
      pullRequestBranchCommits: 0,
      mergeCommits: 0,
      comments: 2,
      reviews: 0,
      newForks: 0,
      releases: i === 0 ? 1 : 0,
    },
    issues: {
      opened: [
        {
          repository: name,
          number: 7,
          title: 'Something <script>alert(1)</script> is broken',
          url: `https://github.com/${name}/issues/7`,
          author: 'bob',
          state: 'open',
          stateReason: null,
          createdAt: at,
          closedAt: null,
          closedBy: null,
          labels: ['bug'],
          assignees: [],
          commentCount: 2,
          bodyExcerpt: 'It <img src=x onerror=alert(1)> fails.',
        },
      ],
      closed: [],
    },
    pullRequests: {
      opened: [],
      merged: [
        {
          repository: name,
          number: 12,
          title: 'Add the thing',
          url: `https://github.com/${name}/pull/12`,
          author: 'alice',
          state: 'closed',
          draft: false,
          createdAt: at,
          closedAt: at,
          mergedAt: at,
          mergedBy: 'carol',
          baseRef: 'main',
          headRef: 'thing',
          headRepository: null,
          additions: 10,
          deletions: 2,
          changedFiles: 3,
          labels: [],
          assignees: [],
          requestedReviewers: [],
          requestedTeams: [],
          reviews: [],
          bodyExcerpt: '',
        },
      ],
      closedUnmerged: [],
      updated: [],
    },
    commits: { defaultBranch: [commit(name, 'abc1234', 12), commit(name, 'def5678', null)], pullRequestBranches: [] },
    discussions: [
      {
        repository: name,
        number: 7,
        kind: 'issue',
        title: 'Something is broken',
        url: `https://github.com/${name}/issues/7`,
        state: 'open',
        commentCount: 2,
        participants: [{ login: 'bob', comments: 2 }],
        recentComments: [],
      },
    ],
    forks: [],
    releases: i === 0 ? [{ tag: 'v1.0.0', name: 'First', url: `https://github.com/${name}/releases/v1.0.0`, author: 'alice', publishedAt: at, prerelease: false }] : [],
  }));
  const waiting: WaitingItem[] = [
    {
      repository: repoNames[0],
      number: 7,
      kind: 'issue',
      title: 'Something is broken',
      url: `https://github.com/${repoNames[0]}/issues/7`,
      draft: false,
      waitingOn: [],
      reasons: [{ code: 'unassigned', users: [], detail: 'New issue, nobody assigned' }],
      since: at,
      lastActor: 'bob',
    },
  ];
  return {
    schemaVersion: SCHEMA_VERSION,
    generator: { name: 'repository-pulse', version: 'test' },
    generatedAt: `${until}T05:00:00Z`,
    window,
    ignoredUsers: [],
    repositories,
    contributors: buildContributors(repositories, waiting),
    waiting,
  };
}
