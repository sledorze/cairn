# Architecture

cairn is split by responsibility so that every decision is pure and unit-tested,
and side effects live only at the edges. This is the separation-of-concerns spine
of the codebase.

## Layers

1. **`core/` — pure decision logic (no IO, no dependencies beyond `node:` builtins).**
   - `DocSummaries.ts` — freshness primitives: content hashing, the `source-sha256`
     stamp, line counting, summary classification (`missing | ok | stale`).
   - `MarkdownLinks.ts` — link extraction, checkable-target rules, ambiguity-aware
     fix suggestions.
   - `SummaryTree.ts` — the hierarchical planner: expected file/directory summaries,
     their manifest hashes, the link-completeness invariant, and the bottom-up order.
   - `glob.ts` — a tiny dependency-free glob matcher for `ignore` and root expansion.

2. **`io/` — the filesystem capability, expressed as an Effect service.**
   - `DocsFs.ts` — `DocsFsLive` binds to the real Node platform; `makeTestDocsFs`
     provides an in-memory layer so the programs are tested without touching disk.

3. **`program/` — Effect programs that orchestrate IO around the pure core.**
   - `CheckLinks.ts` — scan for dead links, optionally auto-repair unambiguous ones.
   - `CheckSummaries.ts` — compute the plan; stamp existing summaries bottom-up.
   - `locale.ts` — report localisation (English default, French mirror).

4. **Edge — config and CLI.**
   - `config.ts` — load `.cairnrc.json` / `package.json` key, merge over defaults,
     expand root globs to concrete directories.
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
