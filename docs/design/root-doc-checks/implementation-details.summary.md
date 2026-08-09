# Implementation details summary: issue #151, Release 1

`src/config.ts`: add a sibling `isFile` predicate next to `isDir`; widen `expandOne`'s
terminal filter loop from `if (yield* isDir(p))` to `if ((yield* isDir(p)) || (yield*
isFile(p)))`. No change needed to intermediate glob-segment resolution or
`assertNoRootEscape`.

`src/io/DocsFs.ts`: `listFiles`'s per-root loop replaces `fs.exists(root)` with
`fs.stat(root)`; when `info.type === 'File'`, push the root directly (subject to the same
file-level `isPrunedDir` ignore check any other file already gets), instead of calling
`walk`. Directory-shaped roots are completely unchanged. The in-memory test double
(`makeTestDocsFs`) needs no change — `isInScope`'s existing equality branch already covers
it.

`checkLinks` (`CheckLinks.ts`) needs zero changes — it already treats `dfs.listFiles`'s
output as a flat file list with no directory assumption.

`checks.summaries`/`checks.coverage`/`checks.docCoverage` are deliberately untouched —
the root-file invocation runs `--links-only`, which already skips summaries, and simply
doesn't enable the coverage checks in its own minimal config. No new schema field is
needed for Release 1; `roots`'s existing string-array schema already accepts a file path,
only its description annotation gains a clarifying clause.

Tests: unit coverage for `expandRoots`/`listFiles` with a file-shaped root (both real
`DocsFsLive` and the in-memory double), plus a real-CLI dogfood (build, run against this
repo's own `AGENTS.md`, deliberately break a link, confirm it's caught, revert).

Risks: `isPrunedDir` reuse against a file-root's own path is new territory needing a real
test, not just assumed-correct by analogy; two CI invocations is an ongoing surface a
future contributor could forget to keep both updated.

See [implementation-details.md](./implementation-details.md) for the full diff-shaped
detail.
