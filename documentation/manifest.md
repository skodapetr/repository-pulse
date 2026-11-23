# `manifest.json` format

`manifest.json` sits at the root of the output directory and lists every report in it. It is the one file that changes from run to run; the reports it points to are written once. Consumers (the viewer, agents, your own tools) start here to find reports: they never need to guess file names. The TypeScript definitions in [`src/model.ts`](../src/model.ts) (`Manifest`, `ManifestEntry`) are the source of truth.

```json
{
  "schemaVersion": 1,
  "latest": "2026-11-21",
  "reports": [
    {
      "date": "2026-11-21",
      "generatedAt": "2026-11-21T05:17:42Z",
      "title": "Dataspecer pulse",
      "window": { "since": "2026-11-14T05:17:42Z", "until": "2026-11-21T05:17:42Z", "days": 7 },
      "files": { "json": "pulse/2026-11-21.json", "markdown": "pulse/2026-11-21.md" }
    }
  ]
}
```

| Field | Description |
|---|---|
| `schemaVersion` | Currently `1`. Goes up when a change breaks existing readers; adding fields does not. |
| `latest` | `date` of the newest report. Always equal to `reports[0].date`. |
| `reports` | One entry per day, newest first. Reports are not necessarily daily or contiguous: a run can use any window, and old reports may have been removed. |
| `reports[].date` | `YYYY-MM-DD` (UTC): the day the window ends, which is the day of the run unless `until` was set. A later run for the same date replaces the earlier report. |
| `reports[].generatedAt` | When the report was generated. |
| `reports[].title` | The `title` input at that time. |
| `reports[].window` | `since` (inclusive), `until` (exclusive) and `days`, as in the report. |
| `reports[].files` | Paths of the report's files, relative to the manifest. Only files that were written are listed: `json` is `pulse/DATE.json` ([format](json-output.md)), `markdown` is `pulse/DATE.md`. |

## How readers should use it

- **The latest report:** `reports[0]`.
- **Earlier reports:** the following entries. Use the listed dates; do not construct names.
- **Resolve paths against the manifest's address**, not the page's: `new URL(entry.files.json, manifestUrl)`.
- **Unknown fields** must be ignored, and a `schemaVersion` higher than the reader knows should be reported, not guessed at.

## How the action maintains it

1. At the start of a run the manifest is read from the output directory (after an optional `restore-url` download). A missing manifest means an empty history; one that cannot be parsed stops the run, because carrying on would erase the history.
2. Entries whose files are not in the directory are dropped with a warning.
3. This run's entry is added, replacing an entry with the same `date`.
4. Entries beyond `history-days` and `history-count` are removed together with their files. The newest entry always stays.
5. The manifest is written last, through a temporary file, so it never lists files that were not written.
