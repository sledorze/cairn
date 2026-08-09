# Incidents, by category

Real, dated mistakes made while building this repo, grouped by the `AGENTS.md` rule each
category produced — one subdirectory per rule, so a new incident in an EXISTING category
only ever touches that subdirectory, never `AGENTS.md` itself. A genuinely new category of
mistake is the only thing that should ever need a new `AGENTS.md` link.

- [red-before-green](./red-before-green) — RED-before-GREEN proof mechanics.
- [adversarial-review](./adversarial-review) — what counts as "trivial enough to skip review."
- [verify-before-push](./verify-before-push) — local-verify gaps a passing gate can still hide.
- [branch-hygiene](./branch-hygiene) — picking the right parent branch for new work.
- [recurrence-gate](./recurrence-gate) — real recurrences the recurrence-gate rule catches.
