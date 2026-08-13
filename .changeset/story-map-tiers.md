---
'@sledorze/cairn': minor
---

New opt-in check: `checks.storyMapTiers.globs` — enforces a real story-mapping invariant
(Jeff Patton's "walking skeleton": exactly one `(Must)`-tagged card per backbone step, the
thinnest slice that works end-to-end) against `## Cards, by backbone step` sections in any
doc matching the configured globs. A step with zero, or more than one, `(Must)`-tagged card
is reported as a violation — the same class of drift a doc can silently accumulate when it
claims a walking skeleton in prose but nothing structurally marks one.

Opt-in via config presence, no CLI flag — same idiom as `checks.freshness`/
`checks.docCoverage`. Rejects `--json` (`jsonUnsupportedMessage`), same as every other
structure check today.

Deliberately narrow: pure intra-document structural census (headings + a `(Must|Should|
Could)` tag regex, masking fenced code first so a doc's own syntax example is never
miscounted) — not a general claims/predicate-checking engine. That larger idea was
investigated separately (`docs/design/137-typed-relations/`) and correctly declined for lack
of evidence; this check doesn't reopen that decision, it solves a narrower, already-real need
in a different shape (no code-target resolution, no comparison predicates).
