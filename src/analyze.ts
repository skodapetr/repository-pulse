import type {
  CommitItem,
  Contributor,
  ItemRef,
  RepositoryReport,
  ReviewItem,
  WaitingItem,
  WaitingReason,
} from './model.js';
import { byTime, ts, uniq } from './util.js';

/** One human action on an issue or pull request. */
export interface Activity {
  type: 'comment' | 'review' | 'commit';
  actor: string;
  at: string;
  reviewState?: string;
  mentions?: string[];
}

export interface WaitingInput {
  repository: string;
  number: number;
  kind: 'issue' | 'pull';
  title: string;
  url: string;
  draft: boolean;
  author: string;
  createdAt: string;
  assignees: string[];
  requestedReviewers: string[];
  requestedTeams: string[];
  /** Human activity only, any order. */
  activity: Activity[];
}

/**
 * Decide who, if anyone, is expected to act on an open item next.
 *
 * Pull requests
 * - review-requested: not a draft and reviewers are still requested (GitHub drops a reviewer once they review).
 * - review-feedback: the latest review by someone else commented or requested changes,
 *   and the author has not pushed or commented since.
 * - approved-not-merged: the latest review approved and the author has not acted since.
 * Issues and pull requests
 * - mentioned: the latest human comment @-mentions people other than its writer.
 * Issues
 * - assignee-to-respond: someone other than the assignees commented last.
 * - author-to-respond: an assignee (or, with no assignees, someone else) commented last
 *   and the issue author is a different person.
 * - unassigned: nobody is assigned and the author spoke last, or the issue is new with no comments.
 */
export function computeWaiting(input: WaitingInput): WaitingItem | null {
  const activity = [...input.activity].sort(byTime((a) => a.at));
  const last = activity.at(-1);
  const reasons: WaitingReason[] = [];
  let since = last?.at ?? input.createdAt;

  if (input.kind === 'pull') {
    const requested = [...input.requestedReviewers, ...input.requestedTeams];
    if (!input.draft && requested.length) {
      reasons.push({
        code: 'review-requested',
        users: requested,
        detail: `Review requested from ${requested.join(', ')}`,
      });
      const lastAuthorCommit = activity.filter((a) => a.type === 'commit' && a.actor === input.author).at(-1);
      since = lastAuthorCommit && ts(lastAuthorCommit.at) > ts(input.createdAt) ? lastAuthorCommit.at : input.createdAt;
    }
    const lastReview = activity
      .filter((a) => a.type === 'review' && a.actor !== input.author && a.reviewState !== 'DISMISSED')
      .at(-1);
    if (lastReview) {
      const authorActedAfter = activity.some(
        (a) => a.actor === input.author && ts(a.at) > ts(lastReview.at) && (a.type === 'commit' || a.type === 'comment'),
      );
      if (!authorActedAfter) {
        if (lastReview.reviewState === 'APPROVED') {
          reasons.push({
            code: 'approved-not-merged',
            users: [input.author],
            detail: `Approved by ${lastReview.actor}, not merged yet`,
          });
        } else {
          const verb = lastReview.reviewState === 'CHANGES_REQUESTED' ? 'requested changes' : 'left review comments';
          reasons.push({
            code: 'review-feedback',
            users: [input.author],
            detail: `${lastReview.actor} ${verb}; no reply or new commits from the author since`,
          });
        }
        since = lastReview.at;
      }
    }
  }

  // Mentioned people who have not acted since the mention.
  const lastComment = activity.filter((a) => a.type === 'comment' || (a.type === 'review' && a.mentions?.length)).at(-1);
  const mentioned = lastComment
    ? (lastComment.mentions ?? []).filter(
        (m) => m !== lastComment.actor && !activity.some((a) => a.actor === m && ts(a.at) > ts(lastComment.at)),
      )
    : [];
  if (lastComment && mentioned.length) {
    reasons.push({
      code: 'mentioned',
      users: mentioned,
      detail: `Mentioned by ${lastComment.actor} in the latest comment`,
    });
    since = lastComment.at;
  }

  if (input.kind === 'issue' && !mentioned.length) {
    const lastActor = last?.actor;
    if (!last) {
      if (!input.assignees.length) {
        reasons.push({ code: 'unassigned', users: [], detail: 'New issue with no assignee and no comments' });
      }
    } else if (input.assignees.length && !input.assignees.includes(lastActor!)) {
      reasons.push({
        code: 'assignee-to-respond',
        users: input.assignees,
        detail: `${lastActor} commented last; assignee to respond`,
      });
    } else if (lastActor !== input.author) {
      reasons.push({
        code: 'author-to-respond',
        users: [input.author],
        detail: `${lastActor} commented last; issue author to respond`,
      });
    } else if (!input.assignees.length) {
      reasons.push({ code: 'unassigned', users: [], detail: 'Author commented last and nobody is assigned' });
    }
  }

  if (!reasons.length) return null;
  return {
    repository: input.repository,
    number: input.number,
    kind: input.kind,
    title: input.title,
    url: input.url,
    draft: input.draft,
    waitingOn: uniq(reasons.flatMap((r) => r.users)),
    reasons,
    since,
    lastActor: last?.actor ?? null,
  };
}

const WEIGHTS = { commit: 1, prOpened: 3, prMerged: 3, mergedForOthers: 1, review: 2, issueOpened: 2, issueClosed: 1, comment: 1 };

export function buildContributors(repositories: RepositoryReport[], waiting: WaitingItem[] = []): Contributor[] {
  const people = new Map<string, Contributor>();
  const person = (login: string, isLogin = true): Contributor => {
    let c = people.get(login);
    if (!c) {
      c = {
        login,
        isLogin,
        repositories: [],
        commits: [],
        pullRequestsOpened: [],
        pullRequestsMerged: [],
        pullRequestsMergedForOthers: [],
        reviews: [],
        issuesOpened: [],
        issuesClosed: [],
        comments: [],
        waitingOn: [],
        activity: 0,
      };
      people.set(login, c);
    }
    c.isLogin ||= isLogin;
    return c;
  };
  const touch = (c: Contributor, repo: string) => {
    if (!c.repositories.includes(repo)) c.repositories.push(repo);
  };
  const ref = (item: ItemRef): ItemRef => ({
    repository: item.repository,
    number: item.number,
    title: item.title,
    url: item.url,
  });

  for (const repo of repositories) {
    const commits: CommitItem[] = [...repo.commits.defaultBranch, ...repo.commits.pullRequestBranches];
    for (const commit of commits) {
      const c = person(commit.author, commit.authorIsLogin);
      c.commits.push(commit);
      touch(c, repo.name);
    }
    for (const pr of repo.pullRequests.opened) {
      const c = person(pr.author);
      c.pullRequestsOpened.push(ref(pr));
      touch(c, repo.name);
    }
    for (const pr of repo.pullRequests.merged) {
      const c = person(pr.author);
      c.pullRequestsMerged.push(ref(pr));
      touch(c, repo.name);
      if (pr.mergedBy && pr.mergedBy !== pr.author) {
        const m = person(pr.mergedBy);
        m.pullRequestsMergedForOthers.push(ref(pr));
        touch(m, repo.name);
      }
    }
    const allPulls = new Map<number, (typeof repo.pullRequests.opened)[number]>();
    for (const list of Object.values(repo.pullRequests)) for (const pr of list) allPulls.set(pr.number, pr);
    for (const pr of allPulls.values()) {
      const byReviewer = new Map<string, ReviewItem[]>();
      for (const review of pr.reviews) {
        if (review.author === pr.author) continue;
        byReviewer.set(review.author, [...(byReviewer.get(review.author) ?? []), review]);
      }
      for (const [login, reviews] of byReviewer) {
        const c = person(login);
        const decisive = reviews.filter((r) => r.state === 'APPROVED' || r.state === 'CHANGES_REQUESTED').at(-1);
        c.reviews.push({ ...ref(pr), state: (decisive ?? reviews.at(-1)!).state, count: reviews.length });
        touch(c, repo.name);
      }
    }
    for (const issue of repo.issues.opened) {
      const c = person(issue.author);
      c.issuesOpened.push(ref(issue));
      touch(c, repo.name);
    }
    for (const issue of repo.issues.closed) {
      if (!issue.closedBy) continue;
      const c = person(issue.closedBy);
      c.issuesClosed.push(ref(issue));
      touch(c, repo.name);
    }
    for (const discussion of repo.discussions) {
      for (const participant of discussion.participants) {
        const c = person(participant.login);
        c.comments.push({ ...ref(discussion), count: participant.comments });
        touch(c, repo.name);
      }
    }
  }

  for (const item of waiting) {
    for (const login of item.waitingOn) {
      if (login.includes('/')) continue; // team
      const c = person(login);
      c.waitingOn.push(ref(item));
      touch(c, item.repository);
    }
  }

  for (const c of people.values()) {
    c.commits.sort(byTime((x) => x.date));
    c.activity =
      c.commits.length * WEIGHTS.commit +
      c.pullRequestsOpened.length * WEIGHTS.prOpened +
      c.pullRequestsMerged.length * WEIGHTS.prMerged +
      c.pullRequestsMergedForOthers.length * WEIGHTS.mergedForOthers +
      c.reviews.length * WEIGHTS.review +
      c.issuesOpened.length * WEIGHTS.issueOpened +
      c.issuesClosed.length * WEIGHTS.issueClosed +
      c.comments.reduce((sum, x) => sum + x.count, 0) * WEIGHTS.comment;
  }
  return [...people.values()].sort((a, b) => b.activity - a.activity || a.login.localeCompare(b.login));
}
