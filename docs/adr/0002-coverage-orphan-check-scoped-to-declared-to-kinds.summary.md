# Coverage/orphan check: direct links only, orphan scoped to `to`-kinds — summary

`checks.coverage`'s non-obvious design points, all found via TDD/adversarial review rather
than designed up front:

- **Orphan status only applies to a kind that appears as some rule's `to` side.** A
  `from`-only kind (e.g. `feature`, which only initiates relations) is never orphan-checked
  — matches real requirements-traceability precedent (an orphan _requirement_, not an
  orphan _anything_).
- **Coverage is direct-link-only, never transitive.** `feature → decision → spec` does not
  satisfy a direct `feature → spec` rule.
- **Rules are deduped by `(name, from, to, via.by)` — this key has been wrong twice.**
  First, deduping by `(from, to)` only collapsed two rules meaning different things on the
  same kind pair (e.g. `implements` vs `verified_by`) into one; `name` became the
  discriminant. Second, adding `via` (below) without adding it here reintroduced the exact
  same bug for any two same-pair rules differing only in `via`. Every future discriminating
  field must be added to this key too — it has no structural guard forcing that.
- **A rule referencing an undeclared kind id (a typo) is a loud config-decode `Failure`.**
  An earlier version of this increment accepted this as a known gap (it would otherwise
  silently, deterministically report every `from`-kind doc as missing forever); closed by
  a cross-field schema check.
- **A rule's `via` field discriminates _how_ it's satisfied**, mirroring `KindSelector`'s own
  `by` field: `{ by: 'link' }` (a direct outbound reference) is the only implemented value
  and the implicit default when `via` is omitted, so a future requirement type is a new
  value, not a breaking change to every rule already written.
- **A kind matching zero scanned docs is a non-fatal `⚠️ unmatchedKinds` warning**, found by
  dogfooding the real CLI against this ADR's own README example: a kind's glob classifies
  docs already inside `roots`, never widens `roots` itself, so a glob outside every root (or
  a typo) used to check nothing while `"✅ Coverage OK (0 doc(s) checked)"` read as genuine
  success. Never affects the exit code — a kind can legitimately have zero docs mid-rollout.

Consequences still accepted for this increment: classification is path-glob only;
`KindSelector`'s `by: 'frontmatter'` variant is declared but unimplemented.
