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

Two file-level report classes, plus a config-level warning:

- **missing coverage** — a `from`-kind doc with no outbound link to a `to`-kind doc.
- **orphan** — a doc of a kind that's supposed to be referenced (a rule's `to` side) with zero inbound references from anywhere in the scanned corpus.
- **unmatched kind** (⚠️, never fails the build) — a declared kind that matched zero scanned docs, most often because its glob falls outside `roots` (a kind's glob classifies docs cairn already scans, it never widens `roots` itself) or is simply mistyped. Without this, that mistake reads as `"✅ Coverage OK (0 doc(s) checked)"` — indistinguishable from a genuinely green repo.

`exempt` (globs) opts a doc out of BOTH missing-coverage and orphan reporting entirely, not orphan status alone — the same escape hatch Sphinx's `:orphan:` and MkDocs' `not_in_nav` needed to keep their equivalent checks tolerable.

A rule may carry an optional `name` (e.g. `"implements"` vs. `"verified_by"`) to distinguish two rules that share the same `from`/`to` kind pair but mean different things — two identically-named (or unnamed) rules on the same pair still dedupe as one. Every rule's `from`/`to` must reference a kind id declared in `kinds` — a typo there is now a loud config error at decode time, not a check that silently, permanently reports everything as missing. A rule may also carry an optional `via: { "by": "link" }`, naming how it's satisfied — the only implemented value today, and the implicit default when omitted, but a discriminated field (not hardcoded logic) so a future requirement type is a new value, not a breaking config change.

This is the one check requirements-traceability tooling, safety-critical audit standards (DO-178C, IEC 62304), and doc generators (Sphinx, MkDocs, Confluence, Obsidian) have all independently converged on as foundational — and it's conspicuously absent from Markdown-specific lint tooling and every ADR tool. Reuses cairn's own existing link-extraction — no new Markdown syntax to author.
