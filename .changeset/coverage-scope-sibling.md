---
'@sledorze/cairn': minor
---

Added two new optional fields to a `checks.coverage` rule:

- `scope: "sibling"` restricts rule satisfaction to a `to`-kind doc in the SAME parent
  directory as the `from` doc, instead of anywhere in the scanned corpus. Closes a real,
  verified gap: a shared, wildcard kind glob (e.g. matching every instance of a repeated
  document-package pattern) let one instance satisfy its rules by cross-linking a completely
  unrelated instance's real docs — a fully hollow "package" could pass with zero warnings by
  linking to a real sibling's content instead of writing its own. `scope: "sibling"` lets one
  small, generic, wildcard-based `kinds`/`rules` block correctly enforce structural
  completeness across many repeated instances of the same pattern (e.g. many independent
  design-doc packages under a shared parent directory) without per-instance config
  duplication, and without reopening a silent "forgot to configure a new instance" gap that
  a naive per-instance-scoped config would otherwise introduce.
- `description` on a rule renders as a real, in-context guidance line under a
  missing-coverage report entry, alongside the existing `name` (which only ever
  disambiguates two rules sharing a `from`/`to` pair — it was never meant to explain
  anything, and didn't). Optional; omitted entirely when absent, never a blank line.

Both fields are additive and opt-in — an existing `checks.coverage` config decodes and
behaves identically with neither field present.
