---
'@sledorze/cairn': minor
---

`cairn check --refs`'s stale-reference report can now show WHY a citation matters, not just
that it changed — when `checks.coverage.kinds` is also configured, each stale entry gets its
citing doc's kind description (and, when the target is itself a `.md` file, the target's
kind description too) as review context, reusing that field's existing, already-mandatory
role — no new config surface.

Dogfooded live against this repo's own `docs/adr`/`docs/design` cross-references before
shipping: real drift on a doc cited by 6 sibling docs surfaced kind guidance on all 6, not a
synthetic example.

Absent by default — a project with no `checks.coverage.kinds` configured (or `--refs` used
alone) behaves identically to before.
