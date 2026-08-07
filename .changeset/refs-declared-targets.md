---
'@sledorze/cairn': minor
---

`cairn check --refs`/`--stamp` can now track a doc's claim about a file it has no reason to
hyperlink. A fenced block tagged `cairn-refs` declares extra targets — one path (optionally
`path#anchor`) per line — tracked exactly like a real link's target: same content hash, same
drift report, same `--stamp`. Closes the gap where a doc's claim about, say,
`package.json#files` had no way to be tracked at all, since nothing in the sentence was a
`[text](path)` link (issue #130).

Absent by default — a doc with no `cairn-refs` block behaves identically to before. No new
config surface.
