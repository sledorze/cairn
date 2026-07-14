<!-- source-sha256: 545ef7de5227239bd983fd3a6000e9edbf6c8155ec267cd47afc8090dfa72259 -->

# Architecture — summary

Separation of concerns: pure decisions, IO at the edges.

- **`core/`** (pure — `node:` builtins + `effect`'s pure combinators only, e.g. `Schema`/
  `Either`/`ParseResult`, never `Effect`/`Layer`/`Runtime`): `DocSummaries` (hash/stamp/
  classify), `MarkdownLinks` (extract/check/fix), `SummaryTree` (hierarchical planner +
  manifest hashes + order), `glob` (tiny matcher), `Config` (schema/decode/`extends`
  merge/defaults — also owns `Locale`, since `core/` can't depend on `program/`).
- **`io/`** `DocsFs`: Effect service — `DocsFsLive` (Node) + `makeTestDocsFs` (in-memory).
- **`program/`**: `CheckLinks`, `CheckSummaries`, `locale` (re-exports `Locale`; en
  default, fr mirror).
- **Edge**: `config.ts` (disk IO: reads rc/`extends`/`package.json`, decodes via
  `core/Config`, expands root globs), `cli.ts`, `init/`.
- **Content hash, not mtime**: git drops mtimes, so time-based checks pass on stale docs
  after a clone; `source-sha256` recompute is clone/CI-proof.
- **Bottom-up one pass**: dir hash = manifest of children's hashes (Merkle) → regenerate
  leaves-first so one pass converges.
