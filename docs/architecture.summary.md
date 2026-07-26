# Architecture — summary

Separation of concerns: pure decisions, IO at the edges.

- **`core/`** (pure — `node:` builtins, `effect`'s pure combinators, e.g. `Schema`/
  `Either`/`ParseResult`, and small vetted IO-free libs like `github-slugger`; never
  `Effect`/`Layer`/`Runtime`): `DocSummaries` (hash/classify; legacy stamp helpers kept
  for migration only), `StampStore`/`RefStore` (`.cairn/**` and `.cairn/refs/**` sidecar
  path mapping + lenient (de)serialisation — separate namespaces, a summary-tree node and
  a scanned doc can be the SAME file), `MarkdownLinks` (extract/check/fix/references),
  `Anchors` (heading/HTML-anchor extraction + slugging, line-anchor validation),
  `markdownFences` (linear fenced-code masking), `SummaryTree` (hierarchical planner +
  manifest hashes compared against an externally-supplied `stamps` map + deleted-source
  detection + order), `glob` (tiny matcher), `paths` (POSIX normalisation +
  `isWithinBase` containment), `Config` (schema/decode/`extends` merge/defaults — also
  owns `Locale`, since `core/` can't depend on `program/`).
- **`io/`** `DocsFs`: Effect service — `DocsFsLive` (Node) + `makeTestDocsFs` (in-memory).
- **`program/`**: `CheckLinks` (dead links/anchors/line-anchors, `--fix`), `CheckRefs`
  (opt-in `--refs`: reference content-hash drift, independent of summary stamping),
  `CheckSummaries` (reads/writes the `.cairn/**` sidecar tree; `stampFiles` self-heals a
  legacy in-content stamp on every ordinary `--stamp`, so `--migrate-stamps` is only an
  optional named alias, never required), `JsonReport` (`--json`'s combined shape),
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
