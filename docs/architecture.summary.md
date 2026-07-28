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
    externally-supplied `stamps` map + deleted-source detection + order).
  - **`links/`**: `MarkdownLinks` (extract/check/fix/references), `Anchors`
    (heading/HTML-anchor extraction + slugging, line-anchor validation, exact-case-insensitive
    anchor-fix suggestions — issue #49, deliberately not fuzzy), `markdownFences`
    (linear fenced-code masking), `RefStore` (`RefsRecord` shape, `.cairn/refs/**`
    namespace — kept disjoint from `StampStore`'s sidecar path: a summary-tree node and a
    scanned doc can be the SAME file, so the two must never collide), `ProseRefs` (pure
    bare-backtick-citation candidate extraction for `--prose-refs`, issue #47).
  - **`structure/`**: the doc-kind/coverage-graph domain (docs/adr/0002, docs/adr/0003) —
    `DocMetadata` (path-glob kind classification + one ordered `heading`/`ref` node
    sequence per doc), `DocGraph` (corpus-wide inbound-reference `Bag`, for orphans),
    `Coverage` (`resolveRuleEdges` — pure rule-satisfaction resolution, extracted out of
    `CheckCoverage.ts` so a future check can reuse it directly).
  - **Shared by both** (top-level `core/`): `sidecar.ts` (the `.cairn/**` path mapping +
    lenient-JSON-codec mechanics `StampStore`/`RefStore` both build on), `hashing.ts`
    (`hashContent` — moved out of `DocSummaries` once it was found to be the one thing
    pulling a `links/` program into a `summaries/`-named file), `glob` (tiny matcher),
    `paths` (POSIX normalisation + `isWithinBase` containment), `Config`
    (schema/decode/`extends` merge/defaults — depends on `summaries/DocSummaries` for the
    configurable `Naming` type; also owns `Locale`, since `core/` can't depend on `program/`).
- **`io/`**: `DocsFs` (Effect service — `DocsFsLive` (Node) + `makeTestDocsFs` in-memory) and
  `Git` (`onlyGitTracked`'s real `git ls-files` capability, plus gitignore/worktree
  pruning — `GitFsLive` + `makeTestGitFs`, `GitUnavailableError` its one named failure
  mode; shells out via `effect`'s own `ChildProcess`/`ChildProcessSpawner`, requiring the
  Node platform layer like `DocsFsLive` does, never baked in; every call scrubs
  repository-pinning env vars and sets `GIT_CEILING_DIRECTORIES`, `gitEnv.ts`).
- **`program/`**, same two-subdomain split, plus a `checks/` abstraction (docs/adr/0003):
  - **`checks/`**: the `CheckPlugin` interface (`isEnabled`/`run`/`format`/`exitCode`,
    optional `jsonUnsupportedMessage`/`stamp`) and its generic runner
    (`runCheckPlugin`/`rejectedJsonMessage`) — `links`/`refs`/`proseRefs`/`coverage` each
    export a plugin descriptor and `cli.ts` drives all four through it; `summaries` stays
    hand-wired (four CLI verbs — check/stamp/prune/migrate-stamps — don't fit the shape).
  - **`summaries/`**: `CheckSummaries` (reads/writes the `.cairn/**` sidecar tree;
    `stampFiles` self-heals a legacy in-content stamp on every ordinary `--stamp`, so
    `--migrate-stamps` is only an optional named alias, never required).
  - **`links/`**: `CheckLinks` (dead links/anchors/line-anchors, `--fix`), `CheckRefs`
    (opt-in `--refs`: reference content-hash drift, independent of summary stamping),
    `CheckProseRefs` (opt-in `--prose-refs`, issue #47: migration aid — resolves prose
    citations rooted at `base`; a resolving one is always silent, only a drifted one is
    reported, with the link syntax to convert it).
  - **`structure/`**: `CheckCoverage` — opt-in (`checks.coverage`'s mere presence)
    missing-coverage/orphan/unmatched-kind reporting over a declared doc-kind graph.
  - **Shared by more than one check**: `JsonReport` (`--json`'s combined shape — only
    links/summaries participate; refs/proseRefs/coverage reject `--json` outright),
    `locale` (re-exports `Locale`; en default, fr mirror).
- **Edge**: `config.ts` (disk IO: reads rc/`extends`/`package.json`, decodes via
  `core/Config`, expands root globs), `cli.ts`, `init/`.
- **`testSupport/`** (test-only, excluded from the published build): real-temp-directory
  fixture helper shared by `*.integration.test.ts` files — not a runtime layer.
- **Content hash, not mtime, tracked outside your docs**: git drops mtimes, so
  time-based checks pass on stale docs after a clone; the hash lives in a hidden
  `.cairn/**` sidecar, never inside the summary's own content, so recompute-and-compare
  is clone/CI-proof AND leaves prose stamp-free. A leftover sidecar with no matching
  node is a deletion signal; `--prune` removes it.
- **Bottom-up one pass**: dir hash = manifest of children's hashes (Merkle) → regenerate
  leaves-first so one pass converges.
