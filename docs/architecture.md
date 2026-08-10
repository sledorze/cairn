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
     - [`DeletionReport.ts`](../src/core/summaries/DeletionReport.ts) —
       opt-in (`--report-deletions`, issue #106): given a batch of docs
       known to have disappeared (their last content, from
       `program/summaries/CheckDeletions.ts`'s git-history read) and the
       current corpus, which of the deleted docs' headings/outbound link
       targets survive nowhere else — informational only, never a blocking
       verdict (deleting genuinely redundant documentation must stay
       cheap).
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
     - [`DeclaredRefs.ts`](../src/core/links/DeclaredRefs.ts) — extraction of
       DECLARED `--refs` targets from a ` ```cairn-refs ``` ` fenced block
       (issue #130): a doc's claim about a file it has no reason to
       hyperlink still gets its drift tracked, feeding the same
       `program/links/CheckRefs.ts` `stampRefs` pipeline a real link's
       target already uses — `checkRefs` itself needs no changes, since it
       only ever replays what `stampRefs` wrote to the sidecar.
     - [`ProseRefs.ts`](../src/core/links/ProseRefs.ts) — pure extraction of
       bare-backtick file-path citations in prose (`--prose-refs`, issue
       #47): which inline code spans look like a rooted repo path, worth
       `program/links/CheckProseRefs.ts` checking. Existence/security is
       deliberately NOT here (needs IO, and reuses `paths.ts`'s
       `isWithinBase` — the same boundary #39/#40 already established).
   - **[`structure/`](../src/core/structure/)** — the doc-kind/coverage-graph
     domain (`checks.coverage`, docs/adr/0002, docs/adr/0003).
     - [`DocMetadata.ts`](../src/core/structure/DocMetadata.ts) — kind
       classification by path glob (`KindSelector`) and one ordered sequence
       of tagged `heading`/`ref` nodes per doc (`extractDocMetadata`),
       reusing `links/Anchors.ts` and `links/MarkdownLinks.ts`'s own
       position-aware extraction.
     - [`DocGraph.ts`](../src/core/structure/DocGraph.ts) — the corpus-wide
       inbound-reference graph (`buildDocGraph`), a `Bag` (never positionally
       meaningful), for orphan detection.
     - [`Coverage.ts`](../src/core/structure/Coverage.ts) — `resolveRuleEdges`:
       pure rule-satisfaction resolution over already-classified docs,
       extracted out of `program/structure/CheckCoverage.ts` so a future
       consumer (e.g. a stale-coverage-link freshness check) reuses the exact
       same kind-matching/path-resolution/`exempt` logic instead of
       re-deriving it (docs/adr/0003's own rationale).
     - [`DocCoverage.ts`](../src/core/structure/DocCoverage.ts) — issue #108's
       pure logic for `checks.docCoverage` (source-tree coverage, the reverse
       direction from `Coverage.ts` above: does some doc link TO this source
       file). Deliberately separate from `Coverage.ts`: a source file isn't a
       scanned, classified doc with its own `nodes`, so this file only ever
       sees the IO layer's already-resolved `coverageByPath` map, never
       Markdown content — kept non-transitive by the same construction
       `Coverage.ts` uses.
     - [`Freshness.ts`](../src/core/structure/Freshness.ts) — issue #101's
       "found using cairn in `sledorze/falsestart`" freshness gap
       (`docs/design/CONVENTION.md`'s "Judging this convention" Claim 2):
       `findStaleDocs`, given a doc's own configured `maxAgeDays` and its
       real last-commit date, decides staleness. Deliberately NOT built on
       `Coverage.ts` above (despite that file's own header anticipating "a
       future consumer, e.g. a stale-coverage-link freshness check" reusing
       its kind-matching) — freshness turned out to be a per-doc TEMPORAL
       question with no relational/kind-graph logic at all, so reusing
       `Coverage.ts` would have imported machinery this check never needs.
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
     for `ignore` and root expansion),
     [`canonicalJson.ts`](../src/core/canonicalJson.ts) (`JSON.stringify`
     with object keys sorted recursively, so a dedup/equality key represents
     a VALUE, not one particular construction order — extracted for
     `program/structure/CheckCoverage.ts`'s own rule-dedup key, generic
     enough that any future caller needing an order-independent structural
     key can reuse it), [`paths.ts`](../src/core/paths.ts)
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
     pruning, plus issue #106's `--report-deletions` detection surface, plus
     issue #101's `checks.freshness` detection surface (`lastCommitDate`, the
     committer date — never mtime — of a path's most recent commit, or `null`
     when it has no commit history yet), plus issue #142/#154's `--explain`
     line-count-delta surface (`historyForPath` + `diffStat`: since cairn's own
     recorded hash is a plain sha256, not a git object id, there is no direct
     git lookup from "this hash" to "which commit produced it" — a caller
     walks `historyForPath`'s newest-first commit list, re-hashing each past
     revision via `readFileAtRef`, until the recorded hash matches or a bound
     is hit, then reads `diffStat` from that commit to the working tree):
     `GitFsLive.listTrackedFiles`/`listIgnoredDirs`/`listWorktreeDirs`/
     `listDeletedSince`/`readFileAtRef`/`lastCommitDate`/`historyForPath`/`diffStat`
     shell out to the real `git` binary
     (`ls-files`, `worktree list`, `diff --name-status --diff-filter=D`,
     `show <ref>:<path>`, `log -1 --format=%cI`, `log --format=%H`,
     `diff --numstat`) via
     `effect`'s own `ChildProcess`/`ChildProcessSpawner`
     (`effect/unstable/process`), not raw `node:child_process` — a typed
     `PlatformError`/exit-code contract instead of hand-wiring a `Promise`
     around a callback. `GitUnavailableError` is its one named failure mode
     (never a silent fallback). Every invocation scrubs the canonical
     repository-pinning env vars and sets `GIT_CEILING_DIRECTORIES`
     ([`gitEnv.ts`](../src/io/gitEnv.ts)) so a hook subprocess in a linked
     worktree, or a `base` without its own `.git`, can never silently resolve
     to the wrong repository (issue: a real incident on this repo's own
     working tree — see `gitEnv.ts`'s own header comment for the full
     writeup). Like
     `DocsFsLive`, `GitFsLive` requires the Node platform's live
     `ChildProcessSpawner` (provided once by the caller via
     `NodeServices.layer`, e.g. in `cli.ts`) rather than baking it in — never
     a zero-dependency layer. `makeTestGitFs` mirrors `DocsFs.ts`'s
     in-memory-double convention.

3. **[`program/`](../src/program/) — Effect programs that orchestrate IO around the pure core.**
   - **[`checks/`](../src/program/checks/)** — the `CheckPlugin` abstraction
     (docs/adr/0003): [`CheckPlugin.ts`](../src/program/checks/CheckPlugin.ts)'s
     `isEnabled`/`run`/`format`/`exitCode`, optional
     `jsonUnsupportedMessage`/`stamp`, plus the generic
     [`runCheckPlugin.ts`](../src/program/checks/runCheckPlugin.ts)
     (`runCheckPlugin`/`rejectedJsonMessage`) runner `cli.ts` drives every
     migrated check through. `links`/`refs`/`proseRefs`/`coverage`/
     `docCoverage` each export a plugin descriptor from their own file
     (below); `summaries`
     deliberately stays OUTSIDE this abstraction — see `CheckPlugin.ts`'s own
     header for why (four CLI verbs — check/stamp/prune/migrate-stamps —
     that don't fit `run`/`format`/`exitCode`).
   - **[`summaries/`](../src/program/summaries/)**
     - [`CheckSummaries.ts`](../src/program/summaries/CheckSummaries.ts) —
       compute the plan; read/write the `.cairn/**` sidecar tree; stamp
       existing summaries bottom-up; one-off `--migrate-stamps` off the
       legacy in-content form; `--explain` (issue #142/#154), best-effort
       enriched with a real git line-count delta per stale file node via
       `io/Git.ts`'s `historyForPath`/`diffStat` — never blocks or changes
       `check`'s own exit code, degrades silently to today's plain text when
       git is unavailable or no matching commit is found within the bound.
     - [`CheckDeletions.ts`](../src/program/summaries/CheckDeletions.ts) —
       opt-in (`--report-deletions`, issue #106), hand-wired like
       `CheckSummaries.ts` above rather than a `CheckPlugin` (needs live
       `GitFs`, which the registry deliberately keeps out — see
       `CheckPlugin.ts`'s own header): `io/Git.ts`'s
       `listDeletedSince`/`readFileAtRef` recover a deleted doc's
       last-known content, `core/summaries/DeletionReport.ts` does the
       actual comparison. `deletionsExitCode` always returns 0.
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
       security boundary as `CheckLinks.ts`. Safe for permanent, ongoing
       use (issue #105), not just a one-time migration step — a resolving
       citation is always silent; only a genuinely drifted one is
       reported, with the exact `[text](path)` syntax that would make it
       structurally checkable.
   - **[`structure/`](../src/program/structure/)**
     - [`CheckCoverage.ts`](../src/program/structure/CheckCoverage.ts) — the
       first check built on `core/structure/`: opt-in (`checks.coverage`'s
       mere presence — `kinds`/`rules` still have no CLI equivalent to
       express them with) missing-coverage/orphan/unmatched-kind reporting
       over a declared doc-kind graph (docs/adr/0002). `--changed <path...>`
       (spike) IS a real CLI flag, but only ever RESCOPES this check's
       already-computed report to the rule edges touching those paths
       (`core/structure/Coverage.ts`'s `filterRuleEdgesByChanged`) — it opts
       nothing in or out, so `checks.coverage`'s presence in config remains
       the sole enablement switch, and the exit code stays corpus-wide rather
       than ever silently narrowing what counts as green. Every cause of a
       non-zero exit is disclosed by the scoped report itself, one of two
       ways: an in-scope unsatisfied rule is shown directly (marked "NOT
       satisfied"); anything not shown there — an unsatisfied rule outside
       scope, or any orphan at all (orphans are per-doc facts, never
       rendered by this report regardless of scope) — is counted in an
       explicit "N other coverage issue(s)" line (round-2 adversarial
       review: an earlier version of that count wrongly excluded an orphan
       whenever the orphan's own path was itself one of the changed paths).
     - [`CheckDocCoverage.ts`](../src/program/structure/CheckDocCoverage.ts) —
       issue #108, opt-in (`checks.docCoverage`'s mere presence, no CLI flag):
       scans the whole `base` tree (not just doc `roots`, since source files
       live outside them) via the same `DocsFs.listFiles`/`ignore` pruning
       every other check uses, filters it into `sources` and `coveredBy`
       doc files, extracts each covering doc's own direct outbound links
       (`core/links/MarkdownLinks.ts`'s `extractReferences`, the same
       extractor `CheckRefs.ts` already uses) and hands the resulting
       `coverageByPath`/`matchedCounts` maps to `core/structure/
DocCoverage.ts`'s pure functions.
     - [`CheckFreshness.ts`](../src/program/structure/CheckFreshness.ts) —
       issue #101, opt-in (`checks.freshness`'s mere presence, no CLI flag):
       scans doc `roots` for the first `rules` glob (declared order) that
       matches each doc, asks `io/Git.ts`'s `lastCommitDate` for its real
       git committer date (never filesystem mtime — resets on every fresh
       clone/CI checkout), and hands the result to `core/structure/
Freshness.ts`'s pure `findStaleDocs`. A doc with no commit history yet, or
       a real `GitUnavailableError`, is silently excluded from staleness —
       surfaced only as a non-fatal warning when EVERY checked doc comes
       back with no git data at all.
   - **Shared by more than one domain**: [`JsonReport.ts`](../src/program/JsonReport.ts)
     (combines a links/summaries run into the single
     `{ summaries, links, exitCode }` shape `--json` prints — only these two
     checks participate; `refs`/`proseRefs`/`coverage`/`docCoverage` all
     reject `--json` outright, via their plugin descriptor's
     `jsonUnsupportedMessage`),
     [`locale.ts`](../src/program/locale.ts) (report localisation, English
     default, French mirror).

4. **Edge — config and CLI.**
   - [`config.ts`](../src/config.ts) — reads `.cairnrc.json` / `package.json`'s
     `cairn` key and `extends` targets from disk, decodes each through
     `core/Config.ts`, and expands root globs to concrete directories. The
     disk IO is the only reason this isn't in `core/`. Fully Effect-based
     (`FileSystem`/`Path` services, `Effect.gen`), matching `io/DocsFs.ts`'s
     own convention — no raw `node:fs`/`node:fs/promises` call anywhere,
     including glob-segment directory listing (`FileSystem.readDirectory`,
     one `fs.stat` per entry to tell directories from files). Unlike
     `io/DocsFs.ts`'s own `walk()`, which keeps a raw-`fs` fallback because
     it recursively visits an entire real doc tree and the extra `stat` per
     entry there is a real cost, `config.ts`'s directory listing only ever
     fires on one glob segment at a time (one path level of a `roots`
     pattern) — small and bounded enough that the same per-entry `stat` is
     negligible.
   - [`cli.ts`](../src/cli.ts) — argument parsing and the Node/Effect bootstrap. Excluded
     from coverage measurement, historically dogfooded via real subprocess only —
     `cli.integration.test.ts` (real-subprocess, spawns the actual CLI) locks in the two
     most fragile behaviors the `checks/` registry (docs/adr/0003) touches directly (the
     `--json` incompatibility gate, the `--refs --stamp`/summaries-`--stamp`
     co-occurrence and ordering) as permanent regression checks. It also self-enforces a
     narrower but real completeness guarantee: every flag `--help` documents must be
     exercised by name somewhere in that file, or its own test fails — closing the exact
     "a flag reaches cli.ts but nothing proves the wiring, ever" gap that let `--fix`,
     `--prune`, `--explain`, `--migrate-stamps`, `--links-only`, `--config`, `--threshold`,
     `--locale`, `--root`, and `init`'s `--agent` go untested at the CLI level despite most
     having solid program-level coverage. Exhaustive coverage of every flag COMBINATION and
     edge case still belongs to manual dogfooding — this only guarantees each flag has at
     least one real, behavior-asserting exercise.
   - [`init/`](../src/init/) — scaffold agent guidance from a single convention
     body: [`content.ts`](../src/init/content.ts) holds the convention prose
     itself, [`generate.ts`](../src/init/generate.ts) (`runInit`) writes it to
     each requested agent target's own file location.
   - [`index.ts`](../src/index.ts) — the package's public, programmatic API
     surface (`import { ... } from '@sledorze/cairn'`), re-exporting the pure
     planners and Effect programs the CLI itself uses, for anyone embedding
     `cairn` rather than shelling out to it.

Deliberately outside this layering: [`testSupport/`](../src/testSupport/) is
test-only real-filesystem fixture tooling (`tempProject.ts`), excluded from
the published build (`tsconfig.build.json`) — it isn't a fifth runtime layer,
just infrastructure the `*.integration.test.ts` files share. Likewise
[`devTools/BenchCliCheck.ts`](../src/devTools/BenchCliCheck.ts) — the
Effect-based core behind `scripts/bench-cli-check.ts` (the perf-regression
gate `bench-guard.sh` runs; see this repo's own "Shipping one iteration well"
guidance), kept in `src/` only so it gets real unit/integration test coverage
like everything else, not because it's a fifth runtime layer either.

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
