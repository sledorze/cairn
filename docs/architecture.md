# Architecture

cairn is split by responsibility so that every decision is pure and unit-tested,
and side effects live only at the edges. This is the separation-of-concerns spine
of the codebase.

## Layers

1. **`core/` — pure decision logic (no IO; `node:` builtins and `effect`'s pure,
   synchronous combinator modules — `Schema`, `Either`, `ParseResult` — are the only
   dependencies allowed. Not `Effect`/`Layer`/`Runtime`: those represent the
   scheduled, effectful part of the library and belong in `program/`.).**
   - `DocSummaries.ts` — freshness primitives: content hashing, the `source-sha256`
     stamp, line counting, summary classification (`missing | ok | stale`).
   - `MarkdownLinks.ts` — link extraction, checkable-target rules, ambiguity-aware
     fix suggestions.
   - `SummaryTree.ts` — the hierarchical planner: expected file/directory summaries,
     their manifest hashes, the link-completeness invariant, and the bottom-up order.
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
   - `CheckSummaries.ts` — compute the plan; stamp existing summaries bottom-up.
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
on stale summaries. Instead, each summary embeds a `source-sha256` of the content it
reflects, and the checker recomputes and compares. This is deterministic and
clone-independent — the property that makes the whole system trustworthy in CI.

## Why bottom-up in one pass

A directory summary's hash is computed over a manifest of its children's hashes — a
Merkle tree. Regenerating leaves-first (file summaries, then directories deepest
first) means a parent always sees already-fresh children, so a single pass converges.
