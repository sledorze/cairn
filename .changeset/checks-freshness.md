---
'@sledorze/cairn': minor
---

Added `checks.freshness`, a new opt-in check: a doc whose real git history (committer date of
its last real commit, not filesystem mtime) is older than its own matching rule's `maxAgeDays`
is reported stale.

```json
"checks": {
  "freshness": {
    "rules": [{ "glob": "docs/adr/**", "maxAgeDays": 365 }]
  }
}
```

`rules` is an ordered array of `{ glob, maxAgeDays }`; the FIRST rule (declared order) whose
glob matches a doc's path applies, and a doc matching none is skipped entirely (not reported,
not counted). A doc with no commit history yet is silently excluded from staleness reporting —
nothing to measure an age from. Absent by default — presence enables it, matching
`checks.docCoverage`'s own opt-in shape. Existing configs are unaffected.
