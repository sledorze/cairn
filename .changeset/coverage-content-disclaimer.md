---
'@sledorze/cairn': minor
---

`checks.coverage` reports (both the ordinary `missing` report and the `--changed`-scoped
guidance report) now print a single, automatic disclaimer — "Coverage only confirms these
links exist — it does not check the linked content's substance..." — whenever at least one
shown rule carries a `description`. Printed at most once per report, never once per entry,
and never for an orphans-only report (orphans are per-doc facts, not tied to any rule's
`description`). Exists because `checks.coverage` only ever verifies a link's existence, never
judges the linked content — a rule's own `description` names a way a link could be hollow,
but that's guidance for a reviewer, not something the tool itself checks.

Also: README.md and `docs/design/CONVENTION.md` gained a concise brief on writing a good
rule `description` — state which doc makes the claim and which is its evidence (direction),
and name one concrete, relationship-specific way a link could be technically present but
hollow, rather than a generic "make sure it's good" or a per-rule repeat of what the new
disclaimer already says. `cairn init --agent claude`'s scaffolded design-package skill
(`DESIGN_PACKAGE_SKILL_BODY`) carries the same brief and revised example rule descriptions,
so a library consumer adopting that scaffold sees the same guidance, not just this repo's own
polished config.
