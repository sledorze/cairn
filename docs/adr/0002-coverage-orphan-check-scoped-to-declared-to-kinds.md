---
status: accepted
---

# Structural coverage/orphan check: direct links only, orphan status scoped to declared `to`-kinds

## Context

`checks.coverage` (issue: ease organizing _product_ knowledge — PRDs, specs, requirements,
decision logs) adds cairn's first structural check beyond freshness/links: a doc of one
declared kind must link to a doc of another. Two design points aren't obvious from the code
alone and would surprise a future reader:

1. **Orphan status only applies to a kind that appears as some rule's `to` side**, not to
   every declared kind. An early draft (found via TDD, not designed up front) flagged a
   `feature` doc as "orphaned" just for having zero inbound links — but nothing is ever
   _supposed_ to link back to a feature; it only _initiates_ relations. Real-world
   precedent (requirements-traceability-matrix tooling, DO-178C/IEC 62304 audits) treats
   "orphan" as a specific role — an orphan _requirement_, not an orphan _anything_.
2. **Coverage is checked by a direct outbound link only — never transitively.** A chain
   `feature → decision → spec` does not by itself satisfy a direct `feature → spec` rule,
   even though a spec is technically reachable from the feature. Confirmed correct by
   construction (an adversarial test), not just asserted.

## Decision

- A rule's `to` kind is the only kind ever eligible for orphan reporting;
  `orphanCandidateKinds = new Set(rules.map(r => r.to))`. A `from`-only kind is never
  orphan-checked, however disconnected it is.
- A `missing`/`orphan` finding requires a **direct** reference — resolved from a doc's own
  `nodes` (its own outbound links), never by walking through an intermediate doc's links.
- The inbound graph (`DocGraph.buildDocGraph`) is built from **every** scanned doc, not just
  declared-kind ones — an ordinary prose doc linking to a decision still clears that
  decision's orphan status, even though only declared-kind docs are themselves reported on.
- Rules are deduped by `(name, from, to)` before evaluation — a duplicated rule entry
  (accidental or config-generated) must report a violation once, not once per duplicate.
  `name` is an optional discriminant, not an afterthought: an earlier version of this fix
  deduped by `(from, to)` alone, which silently collapsed two rules sharing a kind pair but
  meaning DIFFERENT things — e.g. `implements` and `verified_by` between the same two
  kinds (issue #28's own worked example) are distinct obligations, not the same rule
  twice. Caught via adversarial review of the dedup fix itself, not the original TDD pass —
  two UNNAMED rules on the same pair still dedupe as one (there's no way to tell them
  apart without a name), but a named rule is never collapsed with a differently-named one.
- Config decode validates, cross-field, that every rule's `from`/`to` matches a kind id
  declared in the same `kinds` array — added after this ADR first shipped, closing a gap
  this ADR originally accepted as a documented limitation. A typo'd kind id used to pass
  schema validation silently and then deterministically report every `from`-kind doc as
  missing forever; it's now a `Failure` at `decodeConfig` time, naming the undeclared id
  and its `rules[i].from`/`rules[i].to` position.

## Considered Options

- **Flag any doc with zero inbound links, regardless of kind.** Rejected: conflates "this
  doc initiates relations" with "this doc is supposed to receive them" — see the `feature`
  example above.
- **Credit transitive coverage** (a chain satisfies an equivalent direct rule). Rejected:
  loses the actual evidence a trace link is supposed to provide — matches how real
  traceability tooling treats a trace as a specific, direct claim, not an inference.

## Consequences

- Classification is path-glob only in this increment (`KindSelector`'s `by: 'path'`
  variant); `by: 'frontmatter'` is declared in the type (room to add without a breaking
  change) but not implemented — a team whose doc kinds aren't distinguishable by directory
  structure alone can't use this check yet.
