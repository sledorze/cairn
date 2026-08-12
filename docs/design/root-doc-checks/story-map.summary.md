# Story map summary: issue #151 (root-level docs reachable by cairn)

Opens with the required, verbatim-across-packages disclosure (short, framework-free — an
earlier draft using Team Topologies vocabulary was reverted on review as a poor fit for a
single-maintainer repo): every role is an internal engineering role (doc author, reviewer,
CI), not a customer persona — see [`../dependencies.md`](../dependencies.md) for this
repo's real cross-package relations.

Backbone: edit a root-level doc → add/change a link → run local checks / open a PR → CI
runs `cairn check` → decide whether the broken link is caught → fix or merge.

Key stories: a maintainer wants a link added to `AGENTS.md` to get the same broken-link
guarantee a `docs/` doc already has, WITHOUT `AGENTS.md` silently gaining an unwanted
`.summary.md` sibling or `checks.coverage` obligation as a side effect. A CI-level
constraint: a file-shaped root must go through the same containment guarantees a
directory-shaped one already does. Today: nothing catches a broken root-doc link
automatically. After this fix: `pnpm check`/CI catches it the same way it already does for
every doc under `docs/`.

Each backbone step now carries exactly one `(Must)`-tagged card (enforced by
`checks.storyMapTiers`).

Walking skeleton: Release 1 — literal-file `roots` entries, consumed via a second
`--links-only` invocation — ships end-to-end and directly resolves the reported pain,
deliberately without yet extending summaries/coverage to root files.

See [story-map.md](./story-map.md) for the full card-by-card map.
