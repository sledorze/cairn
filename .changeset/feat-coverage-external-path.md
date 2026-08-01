---
'@sledorze/cairn': minor
---

`checks.coverage` rules can now target `{ "external": "path" }` instead of a declared doc kind — closes the third check from issue #28's v1 scope: doc→code reference resolution. A rule like

```json
"rules": [{ "from": "spec", "to": { "external": "path" }, "name": "verified_by" }]
```

is satisfied only when a `spec` doc links to a path that really exists on disk (source code, a test, anything — not just another scanned/kind-classified doc). Unlike a kind-based `to`, this never makes its target eligible for orphan reporting.

This is a **stricter** check for anyone already using `checks.coverage` with a rule whose `to` they intend to change to `{ "external": "path" }` — existing configs (every `to` still a plain kind-id string) are completely unaffected, and no existing rule silently changes meaning.
