---
'@sledorze/cairn': minor
---

`cairn check`'s link checker now validates heading anchors (`[text](./guide.md#section)` and same-page `[text](#section)`, GitHub-slug compatible) and resolves link targets outside the configured `roots` as long as they stay inside the repository checkout — both previously silently accepted regardless of whether they were actually true. It also validates GitHub-style line anchors (`#L10`, `#L10-L20`) on such cross-hierarchy targets. Existence/anchor checks for anything outside the checkout root are never attempted, by design. `BrokenLink` gained an additive, optional `reason: 'path' | 'anchor' | 'line'` field in `--json` output.

This can flip a previously-green repo to red: an anchor or cross-hierarchy link that was never actually checked before may now be reported broken if it doesn't really resolve.
