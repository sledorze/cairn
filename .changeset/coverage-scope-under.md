---
'@sledorze/cairn': minor
---

`checks.coverage`'s rule `scope` gains a second, additive option: `{ under: "some/project/relative/dir" }`. It restricts rule satisfaction to a `to`-kind doc whose resolved path is nested anywhere below the given directory — narrower than the unscoped default (satisfied by a `to`-kind doc anywhere in the scanned corpus), broader than `scope: "sibling"` (exact same parent directory only). Useful for scoping a wildcard-glob rule to a named sub-tree (e.g. one team's own `docs/design/` packages) without limiting it to a single directory or opening it to the whole corpus.

```json
{ "from": "roadmap", "to": "spikes", "scope": { "under": "docs/design/team-b" } }
```

`scope: "sibling"` and the unscoped default keep decoding and behaving exactly as before — purely additive, no config written before this field existed changes meaning.

`under` is rejected at config-decode time when it's empty or only slashes (`""`, `"/"`, `"///"`) — that value would otherwise collapse the matcher's `**/<under>/**` glob into one that matches every path in the corpus, a silent, vacuous "scope" indistinguishable in a report from a real, intentional one (found by adversarial review before this shipped).

Known limitation, recorded rather than silently left implicit: `under` is otherwise a plain string with no validation against the config's own `roots` — a typo or an out-of-scope value still decodes successfully and then silently, permanently reports every rule using it as unsatisfiable, unlike a `from`/`to` kind-id typo (already rejected at decode time). See `docs/design/review-prompts.md`'s section 4 for the full finding.
