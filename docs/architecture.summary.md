<!-- source-sha256: e1953d3c10325ccf3ff751b1761a3d3b7c9777924e087dd6cccb4e8c21399a79 -->

# Architecture — summary

Separation of concerns: pure decisions, IO at the edges.

- **`core/`** (pure, no deps): `DocSummaries` (hash/stamp/classify), `MarkdownLinks`
  (extract/check/fix), `SummaryTree` (hierarchical planner + manifest hashes + order),
  `glob` (tiny matcher).
- **`io/`** `DocsFs`: Effect service — `DocsFsLive` (Node) + `makeTestDocsFs` (in-memory).
- **`program/`**: `CheckLinks`, `CheckSummaries`, `locale` (en default, fr mirror).
- **Edge**: `config.ts` (`.cairnrc.json` merge + root-glob expansion), `cli.ts`, `init/`.
- **Content hash, not mtime**: git drops mtimes, so time-based checks pass on stale docs
  after a clone; `source-sha256` recompute is clone/CI-proof.
- **Bottom-up one pass**: dir hash = manifest of children's hashes (Merkle) → regenerate
  leaves-first so one pass converges.
