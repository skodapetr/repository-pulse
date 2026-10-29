/**
 * The report model. This is exactly what the `json` component writes, so it
 * doubles as the output contract. Bump SCHEMA_VERSION on breaking changes and
 * keep docs/json-output.md in sync.
 */

export const SCHEMA_VERSION = 1;

export interface Report {
  schemaVersion: number;
  generator: { name: string; version: string };
  /** When the report was generated (ISO 8601, UTC). */
  generatedAt: string;
  window: TimeWindow;
  /** Logins excluded as bots or configured as ignored. */
  ignoredUsers: string[];
  repositories: RepositoryReport[];
  /** Activity per person across all repositories, sorted by amount of activity. */
  contributors: Contributor[];
  /** Open items where someone is expected to act, across all repositories. */
  waiting: WaitingItem[];
}

export interface TimeWindow {
  /** Inclusive start (ISO 8601, UTC). */
  since: string;
  /** Exclusive end (ISO 8601, UTC). */
  until: string;
  days: number;
}

export interface RepositoryReport {
  /** owner/name */
  name: string;
  url: string;
  defaultBranch: string;
  /** Totals at generation time, not at the end of the window. */
  totals: {
    stars: number;
    forks: number;
    watchers: number;
    openIssues: number;
    openPullRequests: number;
  };
  /** Counts of activity inside the window. */
  numbers: {
    issuesOpened: number;
    issuesClosed: number;
    pullRequestsOpened: number;
    pullRequestsMerged: number;
    pullRequestsClosedUnmerged: number;
    /** Non-merge commits that reached the default branch. */
    defaultBranchCommits: number;
    /** Commits pushed to open or merged pull request branches that are not on the default branch. */
    pullRequestBranchCommits: number;
    mergeCommits: number;
    comments: number;
    reviews: number;
    newForks: number;
    releases: number;
  };
  issues: {
    opened: IssueItem[];
    closed: IssueItem[];
  };
  pullRequests: {
    opened: PullRequestItem[];
    merged: PullRequestItem[];
    closedUnmerged: PullRequestItem[];
    /** Open pull requests with human activity in the window that were not opened in it. */
    updated: PullRequestItem[];
  };
  commits: {
    /** Non-merge commits on the default branch, oldest first. */
    defaultBranch: CommitItem[];
    /** Commits on pull request branches that are not on the default branch, oldest first. */
    pullRequestBranches: CommitItem[];
  };
  /** Issues and pull requests that received human comments or reviews in the window, most active first. */
  discussions: Discussion[];
  forks: ForkItem[];
  releases: ReleaseItem[];
}

export interface IssueItem {
  repository: string;
  number: number;
  title: string;
  url: string;
  author: string;
  state: 'open' | 'closed';
  stateReason: string | null;
  createdAt: string;
  closedAt: string | null;
  closedBy: string | null;
  labels: string[];
  assignees: string[];
  /** Total comment count on the item, not limited to the window. */
  commentCount: number;
  /** Cleaned and truncated description. */
  bodyExcerpt: string;
}

export interface PullRequestItem {
  repository: string;
  number: number;
  title: string;
  url: string;
  author: string;
  state: 'open' | 'closed';
  draft: boolean;
  createdAt: string;
  closedAt: string | null;
  mergedAt: string | null;
  mergedBy: string | null;
  baseRef: string;
  headRef: string;
  /** owner/name of the head repository when it differs from the base (pull request from a fork). */
  headRepository: string | null;
  additions: number;
  deletions: number;
  changedFiles: number;
  labels: string[];
  assignees: string[];
  /** Users still asked to review. GitHub removes a reviewer once they submit a review. */
  requestedReviewers: string[];
  requestedTeams: string[];
  /** Reviews submitted in the window, by humans. */
  reviews: ReviewItem[];
  bodyExcerpt: string;
}

export interface ReviewItem {
  author: string;
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED';
  submittedAt: string;
  url: string;
  bodyExcerpt: string;
}

export interface CommitItem {
  repository: string;
  sha: string;
  url: string;
  /** GitHub login when the commit email is linked to an account, otherwise the git author name. */
  author: string;
  authorIsLogin: boolean;
  /** Committer date, which is what decides whether the commit falls in the window. */
  date: string;
  /** First line of the commit message. */
  message: string;
  /** Pull request the commit came from, when known. */
  pullRequest: number | null;
}

export interface Discussion {
  repository: string;
  number: number;
  kind: 'issue' | 'pull';
  title: string;
  url: string;
  state: 'open' | 'closed';
  /** Human comments (issue comments, review comments and reviews with a body) in the window. */
  commentCount: number;
  participants: Array<{ login: string; comments: number }>;
  /** Up to the last five human comments in the window, oldest first. */
  recentComments: CommentItem[];
}

export interface CommentItem {
  author: string;
  createdAt: string;
  url: string;
  bodyExcerpt: string;
  /** Logins @-mentioned in the comment (outside code and quotes). */
  mentions: string[];
}

export interface ForkItem {
  fullName: string;
  url: string;
  owner: string;
  createdAt: string;
}

export interface ReleaseItem {
  tag: string;
  name: string;
  url: string;
  author: string;
  publishedAt: string;
  prerelease: boolean;
}

export type WaitingReasonCode =
  | 'review-requested'
  | 'review-feedback'
  | 'approved-not-merged'
  | 'mentioned'
  | 'assignee-to-respond'
  | 'author-to-respond'
  | 'unassigned';

export interface WaitingReason {
  code: WaitingReasonCode;
  /** Who is expected to act. Empty for `unassigned`. */
  users: string[];
  /** Human-readable explanation. */
  detail: string;
}

export interface WaitingItem {
  repository: string;
  number: number;
  kind: 'issue' | 'pull';
  title: string;
  url: string;
  draft: boolean;
  /** Union of users across all reasons. */
  waitingOn: string[];
  reasons: WaitingReason[];
  /** Time of the activity the wait started from. */
  since: string;
  /** Who acted last, when known. */
  lastActor: string | null;
}

export interface ItemRef {
  repository: string;
  number: number;
  title: string;
  url: string;
}

export interface Contributor {
  login: string;
  /** False when this is a git author name not linked to a GitHub account. */
  isLogin: boolean;
  repositories: string[];
  commits: CommitItem[];
  pullRequestsOpened: ItemRef[];
  pullRequestsMerged: ItemRef[];
  /** Pull requests by others that this person merged. */
  pullRequestsMergedForOthers: ItemRef[];
  reviews: Array<ItemRef & { state: ReviewItem['state']; count: number }>;
  issuesOpened: ItemRef[];
  issuesClosed: ItemRef[];
  comments: Array<ItemRef & { count: number }>;
  /** Open items where this person is expected to act (see `waiting`). */
  waitingOn: ItemRef[];
  /** Weighted activity score used for sorting. */
  activity: number;
}
