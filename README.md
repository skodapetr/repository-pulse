# Repository Pulse

A GitHub Action that reports what happened in a set of repositories over a time window. It is meant for maintainers who want to keep a hand on the pulse: what was merged and pushed, what was opened and closed, what each person did, and who is expected to act next.

One run collects the data once and passes it to the components you choose:

| Component | Writes | For |
|---|---|---|
| `json` | `pulse.json` | Tools and later aggregation. The full report model, see [documentation/json-output.md](documentation/json-output.md). |
| `html` | `index.html` | People. A single self-contained page (no external assets, light and dark mode) ready for GitHub Pages. |
| `agent` | `pulse.md` | Agents. Dense Markdown with stable references, description excerpts and recent comments, so an agent can write the narrative. |
| `step-summary` | the run's job summary | A quick look on the workflow run page. |

The action is stateless: each run looks at one window and writes its files. It calls no AI service and needs no keys beyond a GitHub token, so the same input always gives the same output.

## Usage

```yaml
- uses: skodapetr/repository-pulse@v1
  with:
    repositories: |
      dataspecer/dataspecer
      dataspecer/ci-specifications
    components: json, html, agent
    days: 7
```

A complete workflow that rebuilds the page every morning and publishes it to GitHub Pages is in [examples/pulse.yml](examples/pulse.yml).

### Inputs

| Input | Default | Description |
|---|---|---|
| `repositories` | (required) | Repositories as `owner/name`, one per line, comma separated or as a `- owner/name` list. `#` starts a comment. |
| `components` | `json, html, agent` | Components to run, in order. |
| `days` | `7` | Window length in days, ending at `until`. Ignored when `since` is set. |
| `since` | | Window start (inclusive), `YYYY-MM-DD` or ISO 8601. |
| `until` | time of the run | Window end (exclusive), `YYYY-MM-DD` or ISO 8601. |
| `output-directory` | `repository-pulse` | Where files are written. |
| `token` | `${{ github.token }}` | Token for reading the repositories. See [Tokens](#tokens). |
| `ignore-users` | | Extra logins to treat as bots. |
| `title` | `Repository pulse` | Title for the page and Markdown. |

All times are UTC. For a calendar week, pass dates: `since: 2026-10-22`, `until: 2026-10-29`.

### Outputs

| Output | Description |
|---|---|
| `output-directory` | Absolute path of the output directory. |
| `files` | All files written, one per line. |
| `json-file`, `html-file`, `agent-file` | Path of each file, empty when the component did not run. |
| `since`, `until` | The resolved window. |
| `waiting-count` | Number of open items where someone is expected to act. |

### Tokens

The default workflow token can read public repositories and the repository the workflow runs in. For private repositories elsewhere, pass a fine-grained personal access token or a GitHub App installation token with read access to issues, pull requests, contents and metadata.

A run makes about 10 requests per repository plus 3 per pull request with activity in the window, so a weekly run over a few active repositories needs well under 200 requests.

## What is collected

For each repository, within the window:

- **Issues** opened and closed, with who closed them.
- **Pull requests** opened, merged and closed without merging, with diff size, requested reviewers and reviews. Open pull requests that only received comments, reviews or commits are listed as updated.
- **Commits** that reached the default branch (merge commits counted separately), each linked to the pull request it came from when known (same SHA, a `(#123)` suffix from squash merges, or the same author and message for rebase merges). Commits pushed to open pull request branches are listed separately.
- **Discussions**: issues and pull requests with human comments, with participants and the last five comments.
- **New forks and releases.**
- **Totals** at the time of the run: stars, forks, watchers, open issues, open pull requests.

Across repositories:

- **Contributors**: per person, commits, pull requests opened, merged and merged for others, reviews, issues opened and closed, comments, and the items they are expected to act on.
- **Waiting on someone**: open items where someone is expected to act next (see below).

Bots are left out everywhere: accounts of type Bot, logins ending in `[bot]` or `-bot`, and anything listed in `ignore-users`.

### Who is waiting on whom

The action works this out by rules from the latest human activity on items with activity in the window, and on open pull requests with pending review requests:

| Reason | Applies to | Rule |
|---|---|---|
| `review-requested` | pull request | Not a draft and reviewers are still requested. GitHub removes a reviewer once they submit a review. |
| `review-feedback` | pull request | The latest review by someone else commented or requested changes, and the author has not pushed or commented since. |
| `approved-not-merged` | pull request | The latest review approved and the author has not acted since. |
| `mentioned` | both | The latest comment @-mentions people who have not acted since. Mentions in code and quotes are ignored. |
| `assignee-to-respond` | issue | Someone other than the assignees commented last. |
| `author-to-respond` | issue | An assignee (or, with nobody assigned, someone else) commented last, and the issue author is a different person. |
| `unassigned` | issue | A new issue with no comments and nobody assigned, or the author commented last and nobody is assigned. |

The rules say who is expected to act, not what has to be decided. The `agent` output carries the comment excerpts an agent needs to describe that.

## Running locally

```sh
npm ci
npm run build
GITHUB_TOKEN=$(gh auth token) node dist/cli.js \
  --repositories dataspecer/dataspecer --since 2026-10-22 --until 2026-10-29 \
  --output-directory out
```

Every action input is also a CLI flag (`--help` lists them). Behind an HTTP proxy, set `NODE_USE_ENV_PROXY=1` (Node 22.21 or later) so `fetch` uses `HTTPS_PROXY`.

## Development

```sh
npm test          # unit tests (rules, parsing, mentions)
npm run typecheck
npm run build     # bundles src/ into dist/, which must be committed
```

`dist/` is committed because GitHub runs actions straight from the repository. Rebuild and commit it with every source change.

To add a component, implement the `Component` interface in `src/components/`, register it in `src/components/index.ts`, and document it here. Components receive the finished report and must not change it.

To release, tag the commit (`v1.2.3`) and move the major tag: `git tag -f v1 && git push -f origin v1`.

## License

MIT
