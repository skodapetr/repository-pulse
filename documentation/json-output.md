# `pulse.json` format

The `json` component writes the report model as it is, so this file is also the contract for anything built on top of the action. The TypeScript definitions in [`src/model.ts`](../src/model.ts) are the source of truth. `schemaVersion` goes up when a change breaks existing readers. Adding fields does not count as breaking.

Conventions:

- Times are ISO 8601 in UTC (`2026-10-28T14:49:48Z`).
- People are GitHub logins. A commit whose e-mail is not linked to an account uses the git author name instead (`authorIsLogin: false`).
- Repositories are `owner/name`.
- Lists inside the window only contain items whose relevant event (creation, closing, merge, commit, comment) falls in `[since, until)`. `totals` are taken at generation time.
- Excerpts are cleaned of HTML and Markdown links, cut to one line and truncated (400 characters).

## Top level

| Field | Type | Description |
|---|---|---|
| `schemaVersion` | number | Currently `1`. |
| `generator` | `{ name, version }` | Which tool wrote the file. |
| `generatedAt` | string | Time of the run. |
| `window` | `{ since, until, days }` | The window. `since` is inclusive and `until` exclusive. |
| `ignoredUsers` | string[] | Bot and ignored logins seen and excluded during the run. |
| `repositories` | RepositoryReport[] | One entry per input repository, in input order. |
| `contributors` | Contributor[] | People across all repositories, most active first. |
| `waiting` | WaitingItem[] | Open items where someone is expected to act, longest-waiting first. |

## RepositoryReport

| Field | Description |
|---|---|
| `name`, `url`, `defaultBranch` | Identity of the repository. |
| `totals` | `stars`, `forks`, `watchers`, `openIssues`, `openPullRequests` at generation time. |
| `numbers` | Counts in the window: `issuesOpened`, `issuesClosed`, `pullRequestsOpened`, `pullRequestsMerged`, `pullRequestsClosedUnmerged`, `defaultBranchCommits` (non-merge), `pullRequestBranchCommits`, `mergeCommits`, `comments` (human issue and review comments), `reviews`, `newForks`, `releases`. |
| `issues.opened`, `issues.closed` | IssueItem[]. An issue opened and closed in the window is in both. |
| `pullRequests.opened`, `.merged`, `.closedUnmerged` | PullRequestItem[]. |
| `pullRequests.updated` | Open pull requests opened before the window that got comments, reviews or commits in it. |
| `commits.defaultBranch` | CommitItem[], non-merge commits on the default branch, oldest first. |
| `commits.pullRequestBranches` | CommitItem[] on branches of pull requests that are not merged, and not on the default branch. |
| `discussions` | Discussion[], most comments first. |
| `forks` | `{ fullName, url, owner, createdAt }[]` created in the window. |
| `releases` | `{ tag, name, url, author, publishedAt, prerelease }[]` published in the window. |

## IssueItem

`repository`, `number`, `title`, `url`, `author`, `state` (`open` or `closed`, current), `stateReason`, `createdAt`, `closedAt`, `closedBy`, `labels`, `assignees`, `commentCount` (all time), `bodyExcerpt`.

## PullRequestItem

`repository`, `number`, `title`, `url`, `author`, `state`, `draft`, `createdAt`, `closedAt`, `mergedAt`, `mergedBy`, `baseRef`, `headRef`, `headRepository` (set for pull requests from forks), `additions`, `deletions`, `changedFiles`, `labels`, `assignees`, `requestedReviewers` (users still asked to review), `requestedTeams` (`org/slug`), `reviews` (ReviewItem[] submitted in the window), `bodyExcerpt`.

State and diff size are current, so a pull request opened in the window may already show as merged.

## ReviewItem

`author`, `state` (`APPROVED`, `CHANGES_REQUESTED`, `COMMENTED`, `DISMISSED`), `submittedAt`, `url`, `bodyExcerpt`.

## CommitItem

`repository`, `sha`, `url`, `author`, `authorIsLogin`, `date` (committer date, which decides window membership), `message` (first line), `pullRequest` (number or `null` for direct pushes).

## Discussion

`repository`, `number`, `kind` (`issue` or `pull`), `title`, `url`, `state`, `commentCount` (human comments and review bodies in the window), `participants` (`{ login, comments }[]`), `recentComments` (up to five CommentItems, oldest first).

CommentItem: `author`, `createdAt`, `url`, `bodyExcerpt`, `mentions` (logins).

## WaitingItem

| Field | Description |
|---|---|
| `repository`, `number`, `kind`, `title`, `url`, `draft` | The item. |
| `waitingOn` | Logins (or `org/team`) expected to act. Empty for `unassigned`. |
| `reasons` | `{ code, users, detail }[]`, where `code` is one of `review-requested`, `review-feedback`, `approved-not-merged`, `mentioned`, `assignee-to-respond`, `author-to-respond`, `unassigned`. See the README for the rules. |
| `since` | Time of the activity the wait started from. |
| `lastActor` | Who acted last, when known. |

## Contributor

| Field | Description |
|---|---|
| `login`, `isLogin` | `isLogin` is false for git author names without a linked account. |
| `repositories` | Where the person was active. |
| `commits` | CommitItem[], oldest first. Default branch and open pull request branches. |
| `pullRequestsOpened`, `pullRequestsMerged`, `pullRequestsMergedForOthers` | ItemRef[] (`repository`, `number`, `title`, `url`). |
| `reviews` | ItemRef plus `state` (the last approve or request-changes, otherwise the last review) and `count`. |
| `issuesOpened`, `issuesClosed` | ItemRef[]. |
| `comments` | ItemRef plus `count`. |
| `waitingOn` | ItemRef[] the person is expected to act on. People listed only here have `activity: 0`. |
| `activity` | Weighted score used for sorting: commits ×1, pull requests opened or merged ×3, merged for others ×1, reviews ×2, issues opened ×2, closed ×1, comments ×1. |
