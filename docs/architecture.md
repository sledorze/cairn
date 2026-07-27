# Architecture

cairn is split by responsibility so that every decision is pure and unit-tested,
and side effects live only at the edges. This is the separation-of-concerns spine
of the codebase.

- [Layers](#layers)
- [Why content hashes, not mtimes](#why-content-hashes-not-mtimes)
- [Why bottom-up in one pass](#why-bottom-up-in-one-pass)

## Layers

Both `core/` and `program/` are further split into the two independently-
gateable check kinds the config schema itself already names
(`ChecksConfig.links`/`.summaries` — `CheckRefs.ts` is a third, still opt-in
via `--refs`, grouped with `links/` because it consumes the same extracted-
reference primitive `MarkdownLinks.ts` produces, not because it's in
`ChecksConfig` yet). This mirrors the real import graph, verified by
construction, not asserted: **`links/` never imports from `summaries/`, in
either `core/` or `program/`.** The one dependency the other way —
`summaries/SummaryTree.ts` importing `links/MarkdownLinks.ts`'s extraction
primitives, for its own link-completeness invariant ("every directory
summary links to every child") — is one-directional and real, not a cycle.

1. **[`core/`](../src/core/) — pure decision logic (no IO; `node:` builtins,
   `effect`'s pure, synchronous combinator modules — `Schema`, `Either`,
   `ParseResult` — and small, vetted, IO-free pure-computation libraries
   (currently: `github-slugger`, for `links/Anchors.ts`'s GitHub-compatible
   heading slugs — a deterministic string transform, not a side effect) are
   the only dependencies allowed for real, shipped source. Not `Effect`/
   `Layer`/`Runtime`: those represent the scheduled, effectful part of the
   library and belong in `program/`. `*.unit.test.ts`/`*.bench.ts` files
   importing `vitest` are exempt, same as everywhere else in the repo —
   dev-only, excluded from `tsconfig.build.json`, never shipped.).**
   - **[`summaries/`](../src/core/summaries/)** — the doc-summary freshness domain.
     - [`DocSummaries.ts`](../src/core/summaries/DocSummaries.ts) — line
       counting, summary classification (`missing | ok | stale`), plus the
       legacy in-content stamp helpers kept only for the one-off
       `--migrate-stamps` path. (Content hashing itself lives in
       `hashing.ts`, one level up — see below.)
     - [`StampStore.ts`](../src/core/summaries/StampStore.ts) — the
       `StampRecord` shape (`{sha256, version}`) and its lenient
       (forward-compatible) (de)serialisation. Path mapping is NOT here —
       see `../sidecar.ts`.
     - [`SummaryTree.ts`](../src/core/summaries/SummaryTree.ts) — the
       hierarchical planner: expected file/directory summaries, their
       manifest hashes (compared against an externally-supplied `stamps`
       map, never read from content), the link-completeness invariant,
       deleted-source stamp detection, and the bottom-up order.
   - **[`links/`](../src/core/links/)** — the link/reference/anchor domain.
     - [`MarkdownLinks.ts`](../src/core/links/MarkdownLinks.ts) — link/
       reference extraction, checkable-target rules, ambiguity-aware fix
       suggestions.
     - [`Anchors.ts`](../src/core/links/Anchors.ts) — heading/HTML-anchor
       extraction and GitHub-compatible slugging, GitHub-style line-anchor
       validation, and exact-case-insensitive-match anchor-fix suggestions
       (`suggestAnchorFix`, issue #49 — deliberately not fuzzy).
     - [`markdownFences.ts`](../src/core/links/markdownFences.ts) —
       fenced-code-block masking (a linear line scan, not a
       backtracking-prone regex), shared by `MarkdownLinks.ts` and `Anchors.ts`.
     - [`RefStore.ts`](../src/core/links/RefStore.ts) — the `RefsRecord`
       shape and its `.cairn/refs/**` namespace (via `../sidecar.ts`'s
       `namespace` parameter — see its own file header for the real path
       collision this closes) for `program/links/CheckRefs.ts`'s drift tracking.
     - [`ProseRefs.ts`](../src/core/links/ProseRefs.ts) — pure extraction of
       bare-backtick file-path citations in prose (`--prose-refs`, issue
       #47): which inline code spans look like a rooted repo path, worth
       `program/links/CheckProseRefs.ts` checking. Existence/security is
       deliberately NOT here (needs IO, and reuses `paths.ts`'s
       `isWithinBase` — the same boundary #39/#40 already established).
   - **Shared by both domains** (top-level `core/`, not inside either
     subdirectory — genuinely used by both, verified by import graph, not
     assumed): [`sidecar.ts`](../src/core/sidecar.ts) (the `.cairn/**` path
     mapping + lenient-JSON-codec mechanics both `StampStore.ts` and
     `RefStore.ts` build on — found worth extracting after the two
     duplicated it independently), [`hashing.ts`](../src/core/hashing.ts)
     (`hashContent`, used by `summaries/` for doc freshness AND by
     `links/CheckRefs.ts` for reference-target drift — moved out of
     `DocSummaries.ts` once an import-graph audit showed it was the one
     function pulling a `links/`-domain program into a `summaries/`-named file),
     [`glob.ts`](../src/core/glob.ts) (a tiny dependency-free glob matcher
     for `ignore` and root expansion), [`paths.ts`](../src/core/paths.ts)
     (POSIX path normalisation and the `base`-containment check
     (`isWithinBase`) that bounds every out-of-`roots` filesystem access in
     `program/`), [`Config.ts`](../src/core/Config.ts) (the config domain:
     `CairnConfigSchema` (via `effect/Schema`, also the source the shipped
     JSON Schema is generated from), the strict decode, `extends`-layer
     merging, and the resolved-config defaults/types — depends on
     `summaries/DocSummaries.ts` for the `Naming` type, since summary
     filenames are configurable; owns `Locale` too (`program/locale.ts`
     re-exports it) since `core/` cannot depend on `program/`).

2. **[`io/`](../src/io/) — real capabilities, each expressed as an Effect service.**
   - [`DocsFs.ts`](../src/io/DocsFs.ts) — `DocsFsLive` binds to the real Node
     platform; `makeTestDocsFs` provides an in-memory layer so the programs
     are tested without touching disk.
   - [`Git.ts`](../src/io/Git.ts) — `onlyGitTracked` (issue #48)'s one real
     capability, plus issue #63's gitignore-aware/worktree-aware directory
     pruning: `GitFsLive.listTrackedFiles`/`listIgnoredDirs`/`listWorktreeDirs`
     shell out to the real `git` binary (`ls-files`, `worktree list`) via
     `effect`'s own `ChildProcess`/`ChildProcessSpawner`
     (`effect/unstable/process`), not raw `node:child_process` — a typed
     `PlatformError`/exit-code contract instead of hand-wiring a `Promise`
     around a callback. `GitUnavailableError` is its one named failure mode
     (never a silent fallback). Every invocation scrubs the canonical
     repository-pinning env vars and sets `GIT_CEILING_DIRECTORIES`
     (`io/gitEnv.ts`) so a hook subprocess in a linked worktree, or a `base`
     without its own `.git`, can never silently resolve to the wrong
     repository (issue: a real incident on this repo's own working tree —
     see `gitEnv.ts`'s own header comment for the full writeup). Like
     `DocsFsLive`, `GitFsLive` requires the Node platform's live
     `ChildProcessSpawner` (provided once by the caller via
     `NodeServices.layer`, e.g. in `cli.ts`) rather than baking it in — never
     a zero-dependency layer. `makeTestGitFs` mirrors `DocsFs.ts`'s
     in-memory-double convention.

3. **[`program/`](../src/program/) — Effect programs that orchestrate IO around the pure core.**
   - **[`summaries/`](../src/program/summaries/)**
     - [`CheckSummaries.ts`](../src/program/summaries/CheckSummaries.ts) —
       compute the plan; read/write the `.cairn/**` sidecar tree; stamp
       existing summaries bottom-up; one-off `--migrate-stamps` off the
       legacy in-content form.
   - **[`links/`](../src/program/links/)**
     - [`CheckLinks.ts`](../src/program/links/CheckLinks.ts) — scan for dead
       links/anchors/line-anchors, optionally auto-repair unambiguous path breaks.
     - [`CheckRefs.ts`](../src/program/links/CheckRefs.ts) — opt-in
       (`--refs`): record and check reference content-hash drift,
       independent of `CheckSummaries.ts`'s Merkle-manifest stamping (a
       different concept, with its own invariants this file doesn't
       entangle with).
     - [`CheckProseRefs.ts`](../src/program/links/CheckProseRefs.ts) —
       opt-in (`--prose-refs`, issue #47): resolves `core/links/ProseRefs.ts`'s
       candidates rooted at `base`, bounded by the same `isWithinBase`
       security boundary as `CheckLinks.ts`. A migration aid, not a
       permanent second checker — a resolving citation is always silent;
       only a genuinely drifted one is reported, with the exact
       `[text](path)` syntax that would make it structurally checkable.
   - **Shared by both**: [`JsonReport.ts`](../src/program/JsonReport.ts)
     (combines a links/summaries run into the single
     `{ summaries, links, exitCode }` shape `--json` prints),
     [`locale.ts`](../src/program/locale.ts) (report localisation, English
     default, French mirror).

4. **Edge — config and CLI.**
   - [`config.ts`](../src/config.ts) — reads `.cairnrc.json` / `package.json`'s
     `cairn` key and `extends` targets from disk, decodes each through
     `core/Config.ts`, and expands root globs to concrete directories. The
     disk IO is the only reason this isn't in `core/`.
   - [`cli.ts`](../src/cli.ts) — argument parsing and the Node/Effect bootstrap.
   - [`init/`](../src/init/) — scaffold agent guidance from a single convention body.

Deliberately outside this layering: [`testSupport/`](../src/testSupport/) is
test-only real-filesystem fixture tooling (`tempProject.ts`), excluded from
the published build (`tsconfig.build.json`) — it isn't a fifth runtime layer,
just infrastructure the `*.integration.test.ts` files share.

## Why content hashes, not mtimes

git does not preserve modification times. After a clone or a CI checkout, every
file shares the same timestamp, so a freshness check based on mtime silently passes
on stale summaries. Instead, each summary's hash is recorded in a hidden `.cairn/**`
sidecar (never inside the summary's own content — see
[`StampStore.ts`](../src/core/summaries/StampStore.ts)), and the checker recomputes the source
hash and compares it to the sidecar. This is deterministic and clone-independent —
the property that makes the whole system trustworthy in CI — and it keeps the
tracking mechanism itself out of the prose a reader opens. A sidecar left behind with
no matching node (source deleted or renamed) is the deletion signal
`findDeletedStamps` reports, independent of whether the summary file itself was also
deleted.

`stampFiles` (the shared core of `stampSummaries`/`migrateStamps` in
[`CheckSummaries.ts`](../src/program/summaries/CheckSummaries.ts)) unconditionally strips any
legacy in-content `<!-- source-sha256 -->` stamp it finds before computing hashes — a deliberate
DX decision: a repo upgrading from the old scheme needs to discover nothing new.
Its existing `stampCommand` (already `--stamp` in every `.cairnrc.json` this tool
ever scaffolded) self-heals in the same run — `--migrate-stamps` exists only as an
explicitly-named alias of the identical behaviour.

## Why bottom-up in one pass

A directory summary's hash is computed over a manifest of its children's hashes — a
Merkle tree. Regenerating leaves-first (file summaries, then directories deepest
first) means a parent always sees already-fresh children, so a single pass converges.
