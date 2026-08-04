---
'@sledorze/cairn': minor
---

`--prose-refs` gets a config-level escape hatch and a more honest report: `checks.proseRefs.ignore`
(an array of exact citation text, or a glob over it) exempts a backticked prose citation from ever
being checked — for a doc that documents a path FORMAT (a sample-path table, a prose example naming
a fictitious filename) rather than citing a real file, which previously had no way to avoid being
flagged as broken.

```json
"checks": {
  "proseRefs": { "ignore": ["src/a.ts", "examples/*.ts"] }
}
```

Absent by default (no ignore list) — existing configs are unaffected. This doesn't enable
`--prose-refs`; the CLI flag still does that, this only tunes it.

Also: the report wording changed from "no longer resolves" to "does not resolve" (and the summary
line from "drifted" to "broken"). `--prose-refs` is a live, stateless existence check with no
history of a citation's target — it cannot tell a citation that was genuinely moved or deleted from
one that was never real (a typo, an illustrative example), so the prior wording implied a certainty
the check never had.
