# ADR 0004 — `--refs` hashing granularity — summary

Issue #101: whole-file `--refs` hashing makes any edit to a cited
file fail the check, even unrelated ones — reported for real (a doc
citing 14 files failed on every unrelated edit to any of them, until
the reporter restructured their source into facades, a workaround
that doesn't generalize). Cairn's own `checks.docCoverage` makes this
repo hit the same issue if `--refs` were enabled today.

**Decision:** ship in three independent releases (full design in
`docs/design/101-refs-symbol-scoping/`):

1. `refs.scope` config (`whole-file`/`ignore` per glob) — zero new
   dependency, fully resolves the reported repro.
2. `unit: "exports-only"` — hash a file's exported declarations, via
   `typescript/unstable/ast`'s `createScanner` (spike-confirmed
   viable, zero new dependency, despite classic `ts.createSourceFile`
   NOT being available at this repo's pinned `typescript` version's
   root export).
3. Symbol-scoped citations (`#name` anchors) — only if real usage
   after (2) still needs it, gated on a hard rename-resilience
   requirement.

A git-diff/indent heuristic was considered and rejected (too fragile,
against this repo's own conventions).

**Evidence basis, stated honestly:** one reported case plus one
independently-verifiable instance in this repo's own dogfooded
config — not confirmed multi-user demand.

**Consequences:** `--refs` gains its first config surface, threaded
into the ALREADY-EXISTING `refsPlugin: CheckPlugin` (an earlier design
draft incorrectly treated this as an open registry question);
`RefRecord` gains an additive `exportHashes` field for Release 2; a
`unit` change triggers a loud, explicit one-time mass re-stamp, never
a silent reinterpretation; `typescript` becomes an optional
`peerDependency` matching `effect`/`github-slugger`'s precedent, never
a hard bundled one; new dependency on the explicitly-`unstable`
`typescript/unstable/*` surface, isolated behind one internal module.
