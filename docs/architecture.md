# Architecture

cairn is split by responsibility so that every decision is pure and unit-tested,
and side effects live only at the edges. This is the separation-of-concerns spine
of the codebase.

## Layers

1. **`core/` — pure decision logic (no IO; `node:` builtins and `effect`'s pure,
   synchronous combinator modules — `Schema`, `Either`, `ParseResult` — are the only
   dependencies allowed. Not `Effect`/`Layer`/`Runtime`: those represent the
   scheduled, effectful part of the library and belong in `program/`.).**
   - `DocSummaries.ts` — freshness primitives: content hashing, line counting,
     summary classification (`missing | ok | stale`), plus the legacy in-content
     stamp helpers kept only for the one-off `--migrate-stamps` path.
   - `StampStore.ts` — the `.cairn/**` sidecar: path mapping between a node and its
     hidden hash record, and lenient (forward-compatible) (de)serialisation.
   - `MarkdownLinks.ts` — link extraction, checkable-target rules, ambiguity-aware
     fix suggestions.
   - `SummaryTree.ts` — the hierarchical planner: expected file/directory summaries,
     their manifest hashes (compared against an externally-supplied `stamps` map,
     never read from content), the link-completeness invariant, deleted-source
     stamp detection, and the bottom-up order.
   - `glob.ts` — a tiny dependency-free glob matcher for `ignore` and root expansion.
   - `Config.ts` — the config domain: `CairnConfigSchema` (via `effect/Schema`, also
     the source the shipped JSON Schema is generated from), the strict decode,
     `extends`-layer merging, and the resolved-config defaults/types. Owns `Locale`
     too (`program/locale.ts` re-exports it) — `core/` cannot depend on `program/`,
     so a type used by both has to live at or below the lower layer.

2. **`io/` — the filesystem capability, expressed as an Effect service.**
   - `DocsFs.ts` — `DocsFsLive` binds to the real Node platform; `makeTestDocsFs`
     provides an in-memory layer so the programs are tested without touching disk.

3. **`program/` — Effect programs that orchestrate IO around the pure core.**
   - `CheckLinks.ts` — scan for dead links, optionally auto-repair unambiguous ones.
   - `CheckSummaries.ts` — compute the plan; read/write the `.cairn/**` sidecar tree;
     stamp existing summaries bottom-up; one-off `--migrate-stamps` off the legacy
     in-content form.
   - `locale.ts` — report localisation (English default, French mirror).

4. **Edge — config and CLI.**
   - `config.ts` — reads `.cairnrc.json` / `package.json`'s `cairn` key and `extends`
     targets from disk, decodes each through `core/Config.ts`, and expands root globs
     to concrete directories. The disk IO is the only reason this isn't in `core/`.
   - `cli.ts` — argument parsing and the Node/Effect bootstrap.
   - `init/` — scaffold agent guidance from a single convention body.

## Why content hashes, not mtimes

git does not preserve modification times. After a clone or a CI checkout, every
file shares the same timestamp, so a freshness check based on mtime silently passes
on stale summaries. Instead, each summary's hash is recorded in a hidden `.cairn/**`
sidecar (never inside the summary's own content — see `StampStore.ts`), and the
checker recomputes the source hash and compares it to the sidecar. This is
deterministic and clone-independent — the property that makes the whole system
trustworthy in CI — and it keeps the tracking mechanism itself out of the prose a
reader opens. A sidecar left behind with no matching node (source deleted or
renamed) is the deletion signal `findDeletedStamps` reports, independent of whether
the summary file itself was also deleted.

`stampFiles` (the shared core of `stampSummaries`/`migrateStamps` in
`CheckSummaries.ts`) unconditionally strips any legacy in-content
`<!-- source-sha256 -->` stamp it finds before computing hashes — a deliberate
DX decision: a repo upgrading from the old scheme needs to discover nothing new.
Its existing `stampCommand` (already `--stamp` in every `.cairnrc.json` this tool
ever scaffolded) self-heals in the same run — `--migrate-stamps` exists only as an
explicitly-named alias of the identical behaviour.

## Why bottom-up in one pass

A directory summary's hash is computed over a manifest of its children's hashes — a
Merkle tree. Regenerating leaves-first (file summaries, then directories deepest
first) means a parent always sees already-fresh children, so a single pass converges.
