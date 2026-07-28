# Coverage/orphan check: direct links only, orphan scoped to `to`-kinds — summary

`checks.coverage`'s two non-obvious design points, both found via TDD/adversarial review
rather than designed up front:

- **Orphan status only applies to a kind that appears as some rule's `to` side.** A
  `from`-only kind (e.g. `feature`, which only initiates relations) is never orphan-checked
  — matches real requirements-traceability precedent (an orphan _requirement_, not an
  orphan _anything_).
- **Coverage is direct-link-only, never transitive.** `feature → decision → spec` does not
  satisfy a direct `feature → spec` rule.
- **Rules are deduped by `(name, from, to)`, not `(from, to)` alone.** A first fix deduped
  by `(from, to)` only, which silently collapsed two rules meaning different things on the
  same kind pair (e.g. `implements` vs `verified_by`) into one — a real regression caught by
  adversarial review of the fix itself. The optional `name` field is the discriminant.

Consequences accepted for this increment: a rule referencing an undeclared kind id (a typo)
isn't validated up front — it deterministically reports every `from`-kind doc as missing,
naming the typo'd id in the message but not catching it at config-decode time. Classification
is path-glob only; `KindSelector`'s `by: 'frontmatter'` variant is declared but unimplemented.
