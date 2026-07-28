---
'@sledorze/cairn': minor
---

New, opt-in structural coverage/orphan check for teams using cairn to organize product knowledge (PRDs, specs, requirements, decision logs), not just code docs. Off by default — presence of `checks.coverage` in config is itself the opt-in, nothing changes for anyone who doesn't configure it.

Declare doc kinds by path glob and a rule that every doc of one kind must link somewhere to a doc of another:

```json
"checks": {
  "coverage": {
    "kinds": [
      { "id": "feature", "select": { "by": "path", "glob": "product/features/**" } },
      { "id": "decision", "select": { "by": "path", "glob": "docs/adr/**" } }
    ],
    "rules": [{ "from": "feature", "to": "decision" }],
    "exempt": ["product/features/templates/**"]
  }
}
```

Two report classes, both file-level:

- **missing coverage** — a `from`-kind doc with no outbound link to a `to`-kind doc.
- **orphan** — a doc of a kind that's supposed to be referenced (a rule's `to` side) with zero inbound references from anywhere in the scanned corpus. `exempt` (globs) opts a doc out entirely, the same escape hatch Sphinx's `:orphan:` and MkDocs' `not_in_nav` needed to keep their equivalent checks tolerable.

This is the one check requirements-traceability tooling, safety-critical audit standards (DO-178C, IEC 62304), and doc generators (Sphinx, MkDocs, Confluence, Obsidian) have all independently converged on as foundational — and it's conspicuously absent from Markdown-specific lint tooling and every ADR tool. Reuses cairn's own existing link-extraction — no new Markdown syntax to author.
