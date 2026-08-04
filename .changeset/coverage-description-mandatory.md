---
'@sledorze/cairn': minor
---

`checks.coverage`'s rule `description` field is now **mandatory whenever a rule has a
`name`** — enforced at config decode time, alongside the existing undeclared-kind check. A
named rule (e.g. `{ from: "spec", name: "implements", to: "decision" }`) with no
`description` will now fail to decode entirely, not just produce a config warning.

This is a real, stricter check, not just a bugfix — if you already use `checks.coverage`
with a named rule and no `description`, `cairn check` will start failing to even load your
config after upgrading. Add a `description` string explaining what the relationship means
and how to satisfy it (rendered directly in the report when the rule is unmet) to fix it. An
unnamed rule (no `name`) is unaffected — its report line is already self-explanatory, so
`description` stays optional there.

Rationale: `name` alone was found to only ever feed a bare disambiguating label into the
report — useful for telling two rules apart, but explaining nothing to a reader unfamiliar
with the vocabulary. Making `description` mandatory exactly where that gap exists (not for
every rule, which would just produce restated filler on already-self-explanatory rules)
closes it by construction instead of leaving it to be remembered.
