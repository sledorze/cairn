---
'@sledorze/cairn': minor
---

`cairn check --refs`/`--stamp` gains its first config-level knob: `refs.scope`, a list of
`{ glob, unit }` groups (`unit: "whole-file"` (default, unchanged) | `"ignore"`) deciding how
finely a reference target's content is hashed. First matching glob (array order) wins; no
match keeps today's only behavior.

Closes issue #101: a doc citing a noisy file it merely mentions in passing used to fail
`--refs` on every unrelated edit to that file. Give that glob `unit: "ignore"` and it's
exempted from hashing entirely — no facade-file restructure needed to work around it.

Absent by default — a project with no `refs.scope` behaves identically to before. ADR 0004
Release 1 (`docs/adr/0004-refs-scoped-hashing-granularity.md`); `unit: "exports-only"`
(hashing a file's exported surface, not its full bytes) is a separate, not-yet-built release.
