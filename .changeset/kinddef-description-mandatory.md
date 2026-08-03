---
'@sledorze/cairn': minor
---

`checks.coverage`'s `KindDef.description` field is now **unconditionally mandatory** —
enforced at config decode time. Every kind declaration (e.g. `{ "id": "spec", "select": {
"by": "path", "glob": "docs/specs/*.md" } }`) must now also carry a `description` string.

This is a real, stricter check, not just a bugfix — if you already use `checks.coverage`
with a `kinds` array, `cairn check` will start failing to even load your config after
upgrading unless every kind has a `description`. Add one explaining what the kind represents
to fix it.

Rationale: unlike a rule, which at least gets an auto-generated report sentence around it
(`no link ("name") to a "X"-kind doc`), a bare kind id has no surrounding sentence at all —
so there's no self-explanatory fallback to fall back on the way an unnamed rule has. Every
kind needs its own real description to be legible to a reader with no prior context.
