# Spikes (issue #137) — summary

Eight probes, run against current `src/` (not the issue's cited 0.9.0 `dist`), scratch code
under `.scratch/137-typed-relations/`:

1. **HTML comment → link: confirmed live.** `stripCode`/`extractLinks` don't mask
   `<!-- [t](p) -->` — it's a real, tracked link.
2. **HTML comment → `--prose-refs`: partially falsified.** A bare path in a comment is
   invisible (confirmed); a _backticked_ path in a comment is captured and checked
   (issue's blanket claim was too broad).
3. **The `#`-anchor asymmetry: confirmed, mechanism located.** `CheckProseRefs.ts`'s
   `resolveOne` never calls `stripAnchor`/`parseTarget`, unlike `CheckLinks.ts`.
4. **Self-refutation hazard: confirmed, both directions, in real code.** A `neverClaims`
   check quoting its own forbidden text flips false; a `covers` check naming its own
   object inline silently passes (the dangerous direction) — both fixed by slug reference
   - one shared stripping helper.
5. **Frontmatter as anchor: confirmed real cost.** `parseFrontmatter` is flat by design —
   no lists/nesting — not a free reuse for a structured relation.
6. **Prettier blank-line hazard: falsified.** Two real runs against this repo's actual
   `prettier@3.9.6`/`.prettierrc` produced identical, idempotent output — no blank line
   inserted. Not a confirmed constraint here.
7. **Walking skeleton, `covers set:published-files`: confirmed, red then green.** A fenced
   ` ```cairn-relation ``` ` block (masked for free by existing `maskFencedCode`), built
   with `makeTempProject`, correctly reports `ok:false, missingFromDoc:[CHANGELOG.md]` on
   the exact #130 incident shape, and `ok:true` before/after.
8. **Vacuity guard: confirmed, refined.** Full set-equality comparisons are already safe
   (a size check catches an empty result); only subset-only comparisons
   (`found.every(...)`) are vacuously true on empty input and need an explicit guard.

**Net effect on the design:** two of the issue's own constraints didn't hold as stated
(spikes 2, 6); spike 5 raises frontmatter's real cost; spikes 4, 7, 8 are the load-bearing
proofs that the Must tier plus one Should-tier predicate is buildable today and actually
catches the reproduced incident.
