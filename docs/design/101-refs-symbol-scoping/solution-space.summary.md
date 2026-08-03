# Solution space (issue #101) — summary

Five options evaluated against `problem-space.md`'s constraints:

- **A. Symbol-scoped citations** (`#exportName` anchor, hash only that
  declaration) — most precise, needs a real parser + a rename-
  resilience story (a renamed symbol must error clearly, not
  false-pass).
- **B. API-surface hashing** — hash a file's exported declarations,
  not its bytes. Solves the reporter's own case WITHOUT a facade
  restructure. Needs a shallower parse than A. Open, unresolved
  question this option does NOT settle: signature-only vs.
  whole-declaration-including-body hashing — needs real evidence, not
  a speculative choice (see `implementation-details.md`).
- **C. Git-diff/indent heuristic** — no parser dependency, but a
  backtracking-prone boundary guess this repo's own conventions
  already steer away from. **Rejected.**
- **D. Per-glob `unit` config** (`whole-file` / `ignore` / later
  `exports-only`) — zero new dependency; even the crudest `ignore`
  unit fully resolves the reporter's exact repro today. Composes
  with A/B, doesn't compete with them.
- **E. Do nothing, keep documenting the limitation** — fine as an
  interim stance, rejected as a durable answer since it works against
  `checks.docCoverage`'s own goal of citing real code widely.

**Synthesis (the roadmap):** D ships first (cheapest, fully resolves
the reported repro), B ships second (general fix, no restructure
needed), A ships third only if real usage after B still shows a need
for it. C is not pursued.
