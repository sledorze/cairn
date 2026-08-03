---
status: accepted
---

# Design packages are structurally enforced by the EXISTING `checks.coverage` kinds/rules — no new config primitive

## Context

Working on [issue #101](https://github.com/sledorze/cairn/issues/101)'s own design package (`docs/design/101-refs-symbol-scoping/`), a
real question surfaced: these are hand-authored Markdown files (`problem-space.md`,
`solution-space.md`, `spikes.md`, `story-map.md`, `roadmap.md`,
`implementation-details.md`, `knowledge.md`) with no consistent internal heading schema
(verified: every file invents its own `##` section names) and no config representation at
all — nothing in `.cairnrc.json` said a design package needed these specific documents.
Two real risks follow: an author could skip a required piece of the shape (no spikes, no
story map) with nothing noticing, and the convention wasn't obviously reusable by anyone
outside this one repo — it existed only as an informal pattern this one PR happened to
follow.

## Decision

**No new config primitive.** `checks.coverage`'s existing `kinds`/`rules` mechanism
(`docs/adr/0002-coverage-orphan-check-scoped-to-declared-to-kinds.md`) already expresses exactly what's needed: declare each required role
(`problem-space`, `solution-space`, `spikes`, `story-map`, `roadmap`,
`implementation-details`, `knowledge`) as a `kind` by path glob, declare a `design-package`
kind for each package's own `_SUMMARY.md`, and add one `{from: design-package, to: <role>}`
rule per required role. A package missing a required piece — or forgetting to link it —
reports as `missing coverage`, the same signal `checks.coverage` already gives for any
other doc→doc obligation.

Materialized in this repo's own `.cairnrc.json` (dogfooding, matching this repo's own
established practice for #108/#101) — see `docs/design/CONVENTION.md` for the full
reasoning, the exact config block (copy-pasteable by any cairn consumer for their own
design docs), and a real falsification (a link removed from `_SUMMARY.md`, caught three
independent ways at once: missing-coverage, orphan detection, and link-completeness;
restored, confirmed green again).

## Consequences

- **Reusable by any cairn consumer**, not just this repo: the config block in
  `docs/design/CONVENTION.md` is copy-pasteable into any `.cairnrc.json`. Kind-based, not
  filename-based — a different naming convention still works, as long as each required
  role has some doc filling it.
- **A real, documented limitation, not glossed over**: `checks.coverage`'s rules aren't
  scoped per-package — a rule is satisfied by a link to ANY doc of the right kind ANYWHERE
  in the corpus, not specifically the SAME package's own doc. Verified concretely (a
  throwaway second package cross-linking an existing package's docs passed cleanly). Closing
  this would need a new selector relation (same-parent-directory) or a dedicated check —
  out of scope here, recorded as a known gap for whoever revisits this at multi-package
  scale.
- No `core/Config.ts` schema change, no new CLI flag, no new check module — this ADR's
  entire "implementation" is a `.cairnrc.json` config block plus this documentation. The
  smallest possible answer that actually holds up under real falsification.

## Alternatives considered

A dedicated `checks.designPackage`-style config key (a "directory must contain files X, Y,
Z" primitive) was the first instinct, but rejected: it would duplicate `checks.coverage`'s
existing kind-classification/rule-satisfaction machinery for no new expressive power this
repo's own case actually needed, and would be exactly the kind of premature new mechanism
`AGENTS.md`'s own "don't add abstractions beyond what the task requires" guidance warns
against. If the per-package-scoping gap above ever needs closing for real, that's the
narrower, evidence-justified feature to design then — not now, speculatively.
