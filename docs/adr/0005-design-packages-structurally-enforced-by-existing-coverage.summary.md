# ADR 0005 — design packages via existing checks.coverage — summary

Working on #101's own design package surfaced a real question:
hand-authored Markdown files with no consistent heading schema and no
config representation — nothing enforced a design package having all
its required pieces.

**Decision:** no new config primitive. `checks.coverage`'s existing
`kinds`/`rules` mechanism already expresses "every design-package
`_SUMMARY.md` must link to a doc of each required role" — declare each
role as a `kind` by glob, add one rule per role. Materialized in this
repo's own `.cairnrc.json`; full reasoning and a real falsification in
`docs/design/CONVENTION.md`.

**Consequences:** reusable by any cairn consumer (copy-pasteable
config, kind-based not filename-based); a real, documented limitation
(rules aren't scoped per-package — verified via a throwaway cross-
linking test package); no schema/CLI/module changes needed at all —
the whole "implementation" is a config block plus documentation.

**Alternatives considered:** a dedicated `checks.designPackage`
primitive — rejected as premature generality duplicating machinery
`checks.coverage` already provides.
