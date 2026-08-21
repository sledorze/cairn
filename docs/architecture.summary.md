# Architecture — summary

Separation of concerns: pure decisions, IO at the edges.

- **`core/`** (pure — `node:` builtins, `effect`'s pure combinators, e.g. `Schema`/
  `Either`/`ParseResult`, and small vetted IO-free libs like `github-slugger`; never
  `Effect`/`Layer`/`Runtime`), split into two subdomains that mirror the config schema's
  own `checks.links`/`checks.summaries` split (verified: `links/` never imports from
  `summaries/`; the one reverse dependency, `SummaryTree` → `MarkdownLinks` for the
  link-completeness invariant, is one-directional):
  - **`summaries/`**: `DocSummaries` (line-count/classify; legacy stamp helpers kept for
    migration only), `StampStore` (`StampRecord` shape + lenient (de)serialisation),
    `SummaryTree` (hierarchical planner + manifest hashes compared against an
    externally-supplied `stamps` map + deleted-source detection + order),
    `DeletionReport` (opt-in `--report-deletions`, issue #106: given a deleted doc's
    last content + the current corpus, which headings/link targets survive nowhere
    else — informational only).
  - **`links/`**: `MarkdownLinks` (extract/check/fix/references), `Anchors`
    (heading/HTML-anchor extraction + slugging, line-anchor validation, exact-case-insensitive
    anchor-fix suggestions — issue #49, deliberately not fuzzy), `markdownFences`
    (linear fenced-code masking), `RefStore` (`RefsRecord` shape, `.cairn/refs/**`
    namespace — kept disjoint from `StampStore`'s sidecar path: a summary-tree node and a
    scanned doc can be the SAME file, so the two must never collide), `ProseRefs` (pure
    bare-backtick-citation candidate extraction for `--prose-refs`, issue #47),
    `DeclaredRefs` (issue #130: extracts extra `--refs` targets from a `cairn-refs` fenced
    block — a doc's claim with no reason to hyperlink still gets drift-tracked, feeding
    `stampRefs`'s existing pipeline; `checkRefs` itself needs no changes).
  - **`structure/`**: the doc-kind/coverage-graph domain (docs/adr/0002, docs/adr/0003) —
    `DocMetadata` (path-glob kind classification + one ordered `heading`/`ref` node
    sequence per doc), `DocGraph` (corpus-wide inbound-reference `Bag`, for orphans),
    `Coverage` (`resolveRuleEdges` — pure rule-satisfaction resolution, extracted out of
    `CheckCoverage.ts` so a future check can reuse it directly), `DocCoverage` (issue #108
    — the reverse direction: source-tree coverage, given an already-resolved
    `coverageByPath` map, never Markdown content itself), `Freshness` (issue #101 — pure
    `findStaleDocs`: given a doc's `maxAgeDays` and real last-commit date, is it stale;
    deliberately NOT built on `Coverage` above, since it's a per-doc temporal question with
    no relational/kind-graph logic), `StoryMapTiers` (a real drift found auditing this
    repo's own story-maps: every one claimed a marked walking-skeleton card per backbone
    step, none actually had exactly one `(Must)`-tagged card per step — pure
    `extractBackboneStepTiers`/`findWalkingSkeletonViolations`, reusing `Anchors.ts`'s
    `extractHeadingsWithPosition`; deliberately narrow intra-document census, not the
    general typed-relations engine issue #137's Release 0 declined to build).
  - **Shared by both** (top-level `core/`): `sidecar.ts` (the `.cairn/**` path mapping +
    lenient-JSON-codec mechanics `StampStore`/`RefStore` both build on), `hashing.ts`
    (`hashContent` — moved out of `DocSummaries` once it was found to be the one thing
    pulling a `links/` program into a `summaries/`-named file), `glob` (tiny matcher),
    `paths` (POSIX normalisation + `isWithinBase` containment), `Config`
    (schema/decode/`extends` merge/defaults — depends on `summaries/DocSummaries` for the
    configurable `Naming` type; also owns `Locale`, since `core/` can't depend on `program/`).
- **`io/`**: `DocsFs` (Effect service — `DocsFsLive` (Node) + `makeTestDocsFs` in-memory) and
  `Git` (`onlyGitTracked`'s real `git ls-files` capability, gitignore/worktree pruning,
  plus issue #106's `listDeletedSince`/`readFileAtRef` (`git diff --diff-filter=D`/
  `show <ref>:<path>`), plus issue #101's `lastCommitDate` (`git log -1 --format=%cI`,
  committer date not mtime, `null` when no history yet) — `GitFsLive` + `makeTestGitFs`,
  `GitUnavailableError` its one named failure mode; shells out via `effect`'s own
  `ChildProcess`/`ChildProcessSpawner`, requiring the Node platform layer like `DocsFsLive`
  does, never baked in; every call scrubs repository-pinning env vars and sets
  `GIT_CEILING_DIRECTORIES`, `gitEnv.ts`).
- **`program/`**, same two-subdomain split, plus a `checks/` abstraction (docs/adr/0003):
  - **`checks/`**: the `CheckPlugin` interface (`isEnabled`/`run`/`format`/`exitCode`,
    optional `jsonUnsupportedMessage`/`stamp`) and its generic runner
    (`runCheckPlugin`/`rejectedJsonMessage`) — `links`/`refs`/`proseRefs`/`coverage`/
    `docCoverage`/`freshness`/`storyMapTiers` each export a plugin descriptor and `cli.ts`
    drives all seven through it; `summaries` stays hand-wired (four CLI verbs —
    check/stamp/prune/migrate-stamps — don't fit the shape).
  - **`summaries/`**: `CheckSummaries` (reads/writes the `.cairn/**` sidecar tree;
    `stampFiles` self-heals a legacy in-content stamp on every ordinary `--stamp`, so
    `--migrate-stamps` is only an optional named alias, never required), `CheckDeletions`
    (opt-in `--report-deletions`, issue #106 — hand-wired, not a `CheckPlugin`, since it
    needs live `GitFs`; `deletionsExitCode` always 0).
  - **`links/`**: `CheckLinks` (dead links/anchors/line-anchors, `--fix`), `CheckRefs`
    (opt-in `--refs`: reference content-hash drift, independent of summary stamping),
    `CheckProseRefs` (opt-in `--prose-refs`, issue #47, safe for permanent use per
    issue #105 — resolves prose citations rooted at `base`; a resolving one is always
    silent, only a drifted one is reported, with the link syntax to convert it).
  - **`structure/`**: `CheckCoverage` — opt-in (`checks.coverage`'s mere presence)
    missing-coverage/orphan/unmatched-kind reporting over a declared doc-kind graph.
    `--changed <path...>` (spike) is a real CLI flag, but only RESCOPES the already-
    computed report to edges touching those paths — it opts nothing in or out, so
    `checks.coverage`'s presence in config remains the sole enablement switch; the exit
    code still stays corpus-wide. Every cause of a non-zero exit is disclosed by the
    scoped report: an in-scope unsatisfied rule shows up directly; anything else — an
    unsatisfied rule outside scope, or any orphan at all (never rendered by this report
    regardless of scope) — is counted in an explicit "N other coverage issue(s)" line.
    `CheckDocCoverage` (issue #108) — opt-in (`checks.docCoverage`'s mere presence):
    scans the whole `base` tree for `sources`/`coveredBy` files, extracts each covering
    doc's own direct links, hands the result to `DocCoverage`'s pure functions.
    `CheckFreshness` (issue #101) — opt-in (`checks.freshness`'s mere presence): matches
    each doc against the FIRST rule glob (declared order), asks `Git.lastCommitDate` for
    its real committer date, hands the result to `Freshness`'s pure `findStaleDocs`; a doc
    with no history (or a real `GitUnavailableError`) is silently excluded, surfaced only
    as a warning when EVERY checked doc has no git data at all. `CheckStoryMapTiers` —
    opt-in (`checks.storyMapTiers`'s mere presence): finds docs matching its `globs`, reads
    them, hands the content to `StoryMapTiers`'s pure functions — no markdown-shape logic
    of its own.
  - **Shared by more than one check**: `JsonReport` (`--json`'s combined shape — only
    links/summaries participate; refs/proseRefs/coverage/docCoverage/freshness/
    storyMapTiers reject `--json` outright), `locale` (re-exports `Locale`; en default, fr
    mirror), `VersionNotice` (a single repo-level `.cairn/version.json` sidecar — which
    cairn version last touched this repo — prints a one-time CHANGELOG.md pointer on
    mismatch, stamped only via `--stamp`).
- **Edge**: `config.ts` (disk IO: reads rc/`extends`/`package.json`, decodes via
  `core/Config`, expands root globs), `cli.ts` (excluded from coverage, historically
  dogfooded via real subprocess only — `cli.integration.test.ts` now locks in its two
  most fragile checks-registry behaviors as permanent, automated real-subprocess tests,
  plus a self-enforced completeness guard that every documented flag is exercised by
  name; exhaustive flag-COMBINATION coverage still isn't attempted), `init/`.
- **`testSupport/`** (test-only, excluded from the published build): real-temp-directory
  fixture helper shared by `*.integration.test.ts` files — not a runtime layer.
- **Content hash, not mtime, tracked outside your docs**: git drops mtimes, so
  time-based checks pass on stale docs after a clone; the hash lives in a hidden
  `.cairn/**` sidecar, never inside the summary's own content, so recompute-and-compare
  is clone/CI-proof AND leaves prose stamp-free. A leftover sidecar with no matching
  node is a deletion signal; `--prune` removes it.
- **Bottom-up one pass**: dir hash = manifest of children's hashes (Merkle) → regenerate
  leaves-first so one pass converges.
