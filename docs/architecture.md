# Architecture

cairn is split by responsibility so that every decision is pure and unit-tested,
and side effects live only at the edges. This is the separation-of-concerns spine
of the codebase.

- [Layers](#layers)
- [Why content hashes, not mtimes](#why-content-hashes-not-mtimes)
- [Why bottom-up in one pass](#why-bottom-up-in-one-pass)

## Layers

1. **[`core/`](../src/core/) — pure decision logic (no IO; `node:` builtins,
   `effect`'s pure, synchronous combinator modules — `Schema`, `Either`,
   `ParseResult` — and small, vetted, IO-free pure-computation libraries
   (currently: `github-slugger`, for `Anchors.ts`'s GitHub-compatible
   heading slugs — a deterministic string transform, not a side effect) are
   the only dependencies allowed. Not `Effect`/`Layer`/`Runtime`: those
   represent the scheduled, effectful part of the library and belong in
   `program/`.).**
   - [`DocSummaries.ts`](../src/core/DocSummaries.ts) — freshness primitives:
     content hashing, line counting, summary classification (`missing | ok |
stale`), plus the legacy in-content stamp helpers kept only for the
     one-off `--migrate-stamps` path.
   - [`StampStore.ts`](../src/core/StampStore.ts) — the `.cairn/**` sidecar:
     path mapping between a node and its hidden hash record, and lenient
     (forward-compatible) (de)serialisation.
   - [`RefStore.ts`](../src/core/RefStore.ts) — the `.cairn/refs/**` sidecar
     (a namespace of its own — see its own file header for why it can't
     reuse `StampStore.ts`'s path mapping): reference content-hash records
     for `program/CheckRefs.ts`'s drift tracking.
   - [`MarkdownLinks.ts`](../src/core/MarkdownLinks.ts) — link/reference
     extraction, checkable-target rules, ambiguity-aware fix suggestions.
   - [`Anchors.ts`](../src/core/Anchors.ts) — heading/HTML-anchor extraction
     and GitHub-compatible slugging, GitHub-style line-anchor validation.
   - [`markdownFences.ts`](../src/core/markdownFences.ts) — fenced-code-block
     masking (a linear line scan, not a backtracking-prone regex), shared by
     `MarkdownLinks.ts` and `Anchors.ts`.
   - [`SummaryTree.ts`](../src/core/SummaryTree.ts) — the hierarchical
     planner: expected file/directory summaries, their manifest hashes
     (compared against an externally-supplied `stamps` map, never read from
     content), the link-completeness invariant, deleted-source stamp
     detection, and the bottom-up order.
   - [`glob.ts`](../src/core/glob.ts) — a tiny dependency-free glob matcher
     for `ignore` and root expansion.
   - [`paths.ts`](../src/core/paths.ts) — POSIX path normalisation and the
     `base`-containment check (`isWithinBase`) that bounds every out-of-`roots`
     filesystem access in `program/`.
   - [`Config.ts`](../src/core/Config.ts) — the config domain:
     `CairnConfigSchema` (via `effect/Schema`, also the source the shipped
     JSON Schema is generated from), the strict decode, `extends`-layer
     merging, and the resolved-config defaults/types. Owns `Locale` too
     (`program/locale.ts` re-exports it) — `core/` cannot depend on
     `program/`, so a type used by both has to live at or below the lower
     layer.

2. **[`io/`](../src/io/) — the filesystem capability, expressed as an Effect service.**
   - [`DocsFs.ts`](../src/io/DocsFs.ts) — `DocsFsLive` binds to the real Node
     platform; `makeTestDocsFs` provides an in-memory layer so the programs
     are tested without touching disk.

3. **[`program/`](../src/program/) — Effect programs that orchestrate IO around the pure core.**
   - [`CheckLinks.ts`](../src/program/CheckLinks.ts) — scan for dead links/
     anchors/line-anchors, optionally auto-repair unambiguous path breaks.
   - [`CheckRefs.ts`](../src/program/CheckRefs.ts) — opt-in (`--refs`):
     record and check reference content-hash drift, independent of
     `CheckSummaries.ts`'s Merkle-manifest stamping (a different concept,
     with its own invariants this file doesn't entangle with).
   - [`CheckSummaries.ts`](../src/program/CheckSummaries.ts) — compute the
     plan; read/write the `.cairn/**` sidecar tree; stamp existing summaries
     bottom-up; one-off `--migrate-stamps` off the legacy in-content form.
   - [`JsonReport.ts`](../src/program/JsonReport.ts) — combines a links/
     summaries run into the single `{ summaries, links, exitCode }` shape
     `--json` prints.
   - [`locale.ts`](../src/program/locale.ts) — report localisation (English
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
[`StampStore.ts`](../src/core/StampStore.ts)), and the checker recomputes the source
hash and compares it to the sidecar. This is deterministic and clone-independent —
the property that makes the whole system trustworthy in CI — and it keeps the
tracking mechanism itself out of the prose a reader opens. A sidecar left behind with
no matching node (source deleted or renamed) is the deletion signal
`findDeletedStamps` reports, independent of whether the summary file itself was also
deleted.

`stampFiles` (the shared core of `stampSummaries`/`migrateStamps` in
[`CheckSummaries.ts`](../src/program/CheckSummaries.ts)) unconditionally strips any
legacy in-content `<!-- source-sha256 -->` stamp it finds before computing hashes — a deliberate
DX decision: a repo upgrading from the old scheme needs to discover nothing new.
Its existing `stampCommand` (already `--stamp` in every `.cairnrc.json` this tool
ever scaffolded) self-heals in the same run — `--migrate-stamps` exists only as an
explicitly-named alias of the identical behaviour.

## Why bottom-up in one pass

A directory summary's hash is computed over a manifest of its children's hashes — a
Merkle tree. Regenerating leaves-first (file summaries, then directories deepest
first) means a parent always sees already-fresh children, so a single pass converges.
