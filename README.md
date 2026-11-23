# Repository Pulse

A GitHub Action that reports what happened in a set of repositories over a time window. It is meant for maintainers who want to keep a hand on the pulse: what was merged and pushed, what was opened and closed, what each person did, and who is expected to act next.

One run collects the data once, writes one report per day, and keeps a history of earlier reports:

| Output | Written as | For |
|---|---|---|
| `json` component | `pulse/DATE.json` | Tools, later aggregation, and the viewer. The full report model, see [documentation/json-output.md](documentation/json-output.md). |
| `agent` component | `pulse/DATE.md` and `pulse.md` | Agents. Dense Markdown with stable references, description excerpts and recent comments, so an agent can write the narrative. `pulse.md` at the root tells an agent how to find the latest one. |
| `step-summary` component | the run's job summary | A quick look on the workflow run page. |
| manifest | `manifest.json` | The index of all reports. Always written, see [documentation/manifest.md](documentation/manifest.md). |
| viewer | `index.html` | People. A page that reads the manifest and renders any report in the browser, with previous and next navigation. Optional and replaceable, see [The viewer](#the-viewer). |

The action calls no AI service and needs no keys beyond a GitHub token, so the same input always gives the same output.

## Output layout

```
<output-directory>/
  index.html              the viewer
  pulse.md                instructions for agents (static)
  manifest.json           index of all reports, newest first
  pulse/2026-11-21.json   one report per day, named by the day its window ends
  pulse/2026-11-21.md
  pulse/2026-11-14.json
  ...
```

Reports are written once and never edited. A second run for the same day replaces that day's report. Only `manifest.json` changes from run to run, which is why nothing has to be rewritten to link reports to each other.

## Usage

```yaml
- uses: skodapetr/repository-pulse@v1
  with:
    repositories: |
      dataspecer/dataspecer
      dataspecer/ci-specifications
    components: json, agent
    days: 7
```

A complete workflow that rebuilds the site every morning, keeps the history and publishes it to GitHub Pages is in [examples/pulse.yml](examples/pulse.yml).

### Inputs

| Input | Default | Description |
|---|---|---|
| `repositories` | (required) | Repositories as `owner/name`, one per line, comma separated or as a `- owner/name` list. `#` starts a comment. |
| `components` | `json, agent` | Components to run, in order: `json`, `agent`, `step-summary`. |
| `days` | `7` | Window length in days, ending at `until`. Ignored when `since` is set. |
| `since` | | Window start (inclusive), `YYYY-MM-DD` or ISO 8601. |
| `until` | time of the run | Window end (exclusive), `YYYY-MM-DD` or ISO 8601. |
| `output-directory` | `repository-pulse` | Where files are written. |
| `token` | `${{ github.token }}` | Token for reading the repositories. See [Tokens](#tokens). |
| `ignore-users` | | Extra logins to treat as bots. |
| `title` | `Repository pulse` | Title for the viewer and Markdown. |
| `history-days` | `-1` | Delete reports more than this many days older than the newest one. `-1` keeps all. |
| `history-count` | `-1` | Keep only this many of the newest reports. `-1` keeps all. |
| `viewer` | `default` | What `index.html` is: `default`, `none`, a path to a viewer script, or an `https` URL of one. See [The viewer](#the-viewer). |
| `restore-url` | | Address of the published site. Earlier reports are downloaded from it before the run. See [Keeping the history](#keeping-the-history). |

All times are UTC. For a calendar week, pass dates: `since: 2026-10-22`, `until: 2026-10-29`.

### Outputs

| Output | Description |
|---|---|
| `output-directory` | Absolute path of the output directory. |
| `files` | All files written, one per line. |
| `json-file`, `agent-file` | Path of this run's `pulse/DATE.json` and `pulse/DATE.md`, empty when the component did not run. |
| `manifest-file`, `viewer-file` | Path of `manifest.json` and `index.html` (empty with `viewer: none`). |
| `since`, `until` | The resolved window. |
| `waiting-count` | Number of open items where someone is expected to act. |

### Tokens

The default workflow token can read public repositories and the repository the workflow runs in. For private repositories elsewhere, pass a fine-grained personal access token or a GitHub App installation token with read access to issues, pull requests, contents and metadata.

A run makes about 10 requests per repository plus 3 per pull request with activity in the window, so a weekly run over a few active repositories needs well under 200 requests.

## Keeping the history

The action looks for `manifest.json` in `output-directory`, adds today's report to it, and then removes reports according to `history-days` and `history-count`. If both are set, a report is removed when either limit says so. The newest report is never removed. Both default to `-1`, keep everything. Entries whose files are missing from the directory are dropped from the manifest with a warning, so the viewer never links to a report that is not there.

A workflow runner starts empty, so the previous site has to be put back before the action runs. There are two ways.

**Restore from the published site** (the simplest): set `restore-url` to the address of the site. The action downloads `manifest.json` and the reports it lists. No token is needed. A missing manifest (HTTP 404) is a first run; any other failure stops the run, so you never publish a site that silently lost its history.

```yaml
- uses: skodapetr/repository-pulse@v1
  with:
    repositories: owner/name
    restore-url: https://owner.github.io/pulse/
    history-days: 90
```

**Keep the site on a branch**: check out the branch into the output directory before the action, and commit and push it afterwards. This needs `contents: write`, and the branch (for example `gh-pages`) is what GitHub Pages publishes.

```yaml
- uses: actions/checkout@v4
  with:
    ref: gh-pages
    path: site
- uses: skodapetr/repository-pulse@v1
  with:
    repositories: owner/name
    output-directory: site
    history-count: 30
- name: Publish
  working-directory: site
  run: |
    git config user.name "github-actions[bot]"
    git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
    git add -A
    git commit -m "Update pulse" || exit 0
    git push
```

(The first run needs the `gh-pages` branch to exist; create it once, empty.) Restoring from the artifact of the previous Pages deployment is not recommended: Pages artifacts expire after one day by default.

## The viewer

`index.html` is a small page that loads a script, the viewer. The viewer fetches `manifest.json`, shows the report named in the address (`index.html#2026-11-14`, the latest when there is none) and fetches that report's `pulse/DATE.json` to render it, with links to the previous and next report. It needs JavaScript and a web server (browsers do not let pages read files from disk).

The `viewer` input chooses where the script comes from:

| Value | Result |
|---|---|
| `default` | The viewer bundled with the action, [viewer/pulse-viewer.js](viewer/pulse-viewer.js), inlined, so the page is self-contained. |
| a path | Your own script, inlined into `index.html`. |
| an `https` URL | `index.html` loads the script from that address. Pin a version if it is not yours. |
| `none` | No `index.html`; use `manifest.json` and the reports directly. |

Because reports are plain data, nothing forces you to use the bundled viewer. To change how reports look, copy [viewer/pulse-viewer.js](viewer/pulse-viewer.js), edit it and set `viewer: path/to/your-copy.js`, or host it and use its URL. The format of the data it reads is in [documentation/manifest.md](documentation/manifest.md) and [documentation/json-output.md](documentation/json-output.md). Text from reports must be put into the page as text (`textContent`), never as HTML; the bundled viewer does this throughout. Changing the viewer changes how every report in the history looks, since reports are rendered in the browser.

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

## Upgrading from 0.1

0.2 changed the output layout: `index.html` is now the viewer, `pulse.md` holds instructions for agents, and the reports moved to `pulse/DATE.json` and `pulse/DATE.md`. The `html` component and the `html-file` output are gone (an `html` entry in `components` is an error that says so). A report written by 0.1 is not picked up into the history; the history starts with the first 0.2 run.

## Running locally

```sh
npm ci
npm run build
GITHUB_TOKEN=$(gh auth token) node dist/cli.js \
  --repositories dataspecer/dataspecer --since 2026-10-22 --until 2026-10-29 \
  --output-directory out
```

To look at the result, serve the directory (`python3 -m http.server -d out`) and open `http://localhost:8000/`. Every action input is also a CLI flag (`--help` lists them). Behind an HTTP proxy, set `NODE_USE_ENV_PROXY=1` (Node 22.21 or later) so `fetch` uses `HTTPS_PROXY`.

## Development

```sh
npm test          # unit tests (rules, parsing, history, viewer helpers)
npm run typecheck # also checks viewer/pulse-viewer.js against the model types
npm run build     # bundles src/ into dist/, which must be committed
```

`dist/` is committed because GitHub runs actions straight from the repository. Rebuild and commit it with every source change. `viewer/pulse-viewer.js` is read from the repository at run time and is not bundled, so changing it needs no rebuild.

To add a component, implement the `Component` interface in `src/components/`, register it in `src/components/index.ts`, and document it here. Components receive the finished report and must not change it. The manifest and the viewer are written by the run itself after the components, because they describe all reports, not one.

To release, tag the commit (`v1.2.3`) and move the major tag: `git tag -f v1 && git push -f origin v1`.

## License

MIT
