---
'@sledorze/cairn': minor
---

`checks.coverage`'s rule `to` field now also accepts `{ atLeast: { n, of } }` — general N-of-M cardinality, satisfied when at least `n` of `of`'s targets EACH have their own satisfying link (not `n` links to the same target), additive alongside the existing single-target and array/`{ any }` shapes:

```json
{ "from": "roadmap", "to": { "atLeast": { "n": 2, "of": ["spikes", "external-evidence", "prior-art"] } } }
```

The rule above requires a `roadmap` doc to link to at least 2 of the 3 listed kinds — linking to only one is not enough, and linking twice to the same one does not count as two. Requiring "all of these" needs no separate shape: it's `n` equal to `of`'s length over the same `atLeast` object.

`{ any: [...] }` is also added as the explicit, named spelling of the array `to` shape that shipped previously (`to: [...]`) — both are accepted and behave identically; the bare array is not deprecated.

Validated at config-decode time, the same as every other structural constraint in this schema: `atLeast.n` must be a positive integer (`n: 0` or negative is rejected — it would make the rule vacuously satisfied by nothing), must not exceed `atLeast.of.length` (a higher `n` could never be satisfied), `atLeast.of` must be non-empty, and `atLeast.of` must not contain a duplicate target (a duplicate would let one real satisfying link count toward `n` twice).

A plain single target, an array `to`, or `{ any: [...] }` — every config written before this shipped — keeps decoding and behaving exactly as before; this is purely additive. This closes the general N-of-M cardinality gap that the previous array-`to` release deliberately left open (only "any one of N" was expressed then).
