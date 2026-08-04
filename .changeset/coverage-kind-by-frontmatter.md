---
'@sledorze/cairn': minor
---

`checks.coverage`'s `KindSelector` gains a second, additive variant: `{ "by": "frontmatter", "field": "status", "equals": "accepted" }` classifies a doc into a kind by matching a flat, top-level YAML frontmatter key/value pair, alongside the existing `{ "by": "path", "glob": "..." }` variant.

Closes a real, concretely-scoped gap this repo's own ADRs (`docs/adr/*.md`) exposed while validating `checks.coverage` against a corpus outside `docs/design/`: every ADR shares one path glob, but a real structural distinction between them (e.g. `status: proposed` vs `status: accepted`) can't be expressed by path alone — only by reading each file's own frontmatter. This lets a rule like "every accepted ADR must be linked from an architecture overview doc" be expressed and enforced, which was previously inexpressible in this schema.

Reads only a flat, top-level `key: value` frontmatter block (no nested YAML, no lists, no multi-line scalars). A doc with no frontmatter, or missing the selector's `field`, simply doesn't match that kind — never a decode error. A doc can match kinds from both selector variants at once.

Purely additive and opt-in: an existing config using only `by: "path"` selectors decodes and behaves identically.
