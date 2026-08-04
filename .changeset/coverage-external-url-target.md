---
'@sledorze/cairn': minor
---

Added a third `CoverageTarget` variant to a `checks.coverage` rule's `to` field:
`{ external: 'url', pattern: '...' }` — satisfied by a doc's outbound Markdown link whose
raw href CONTAINS `pattern` (a plain substring match, not a regex/glob DSL). Closes a real,
previously self-reported gap: `to` could only name a declared kind id or `{ external: 'path'
}` (a link resolving to a real file on disk), with no way to require a link to an external
URL — e.g. every design-package `problem-space.md` must link its originating GitHub issue.

```json
{
  "from": "problem-space",
  "name": "traces_to",
  "to": { "external": "url", "pattern": "https://github.com/OWNER/REPO/issues/" }
}
```

Purely additive and opt-in — an existing `checks.coverage` config (including one already
using `{ external: 'path' }`) decodes and behaves identically with no `{ external: 'url' }`
rule present.
