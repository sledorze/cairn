---
'@sledorze/cairn': patch
---

Fixed a latent bug in `checks.coverage`'s rule-deduplication: the dedup key used plain
`JSON.stringify`, which is sensitive to object-property insertion order. Two `CoverageRule`
values that were semantically identical but had their nested `to`/`scope` object keys built in
a different order (possible via a hand-written config or a future programmatic rule-builder)
could be treated as two _different_ rules instead of deduplicating to one — under-reporting
the opposite way from every prior dedup-key bug this feature has hit. Fixed by canonicalizing
object keys (recursively sorted) before stringifying. No config shape changed; this only
affects internal deduplication, not what a valid config looks like.
