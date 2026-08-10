# Design packages

Full problem-space → solution-space → roadmap design work for non-trivial issues, done
before implementation starts — distinct from `docs/adr/`, which records the resulting
DECISION concisely; these packages carry the full reasoning and evidence behind it.

- [Convention](./CONVENTION.md) — the required package shape, and how `checks.coverage`
  (an existing cairn feature, not a new one) enforces it structurally — reusable by any
  cairn consumer for their own design docs.
- [Review prompts](./review-prompts.md) — two reusable, business-agnostic prompts for
  proposing and adversarially judging a `checks.coverage` structure in any documentation
  domain.
- [Review findings](./review-findings.md) — the real, dated evidence from every round of
  actually running those prompts against this repo's own `checks.coverage` schema and
  config, split out from `review-prompts.md` once it grew past a lean reference.
- [Cross-package dependencies](./dependencies.md) — the top-level, non-sibling-scoped
  register of REAL cross-package relations, tagged with plain, framework-free dependency
  vocabulary (currently: stable-interface dependency) — where a claim about ANOTHER
  package's state belongs, instead of as free prose inside a sibling-scoped roadmap.md.
- [101 — `--refs` symbol/export-scoped hashing](./101-refs-symbol-scoping/_SUMMARY.md)
- [137 — typed relations](./137-typed-relations/_SUMMARY.md)
- [151 — root-level docs reachable by cairn](./root-doc-checks/_SUMMARY.md)
