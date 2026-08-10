---
'@sledorze/cairn': minor
---

New `cairn check --changed <path...>` flag (repeatable, relative-to-cwd or absolute):
when `checks.coverage` is configured, scopes its report to just the rule edges touching
those paths — as a rule's own `from` doc, or as a doc some other rule's edge resolved to
(a `satisfiedBy` target) — and prints each matching rule's own `description` as guidance
instead of the full corpus report: "if this file changed, here's what a reviewer should
re-check, and why." Aimed at AI-review tooling that already knows which files a diff
touched and wants targeted guidance rather than the whole coverage report.

The exit code stays corpus-wide even under `--changed` — it never narrows to just the
scoped edges, so a real problem in an untouched file still fails the build exactly like
running without the flag. Every cause of that non-zero exit is disclosed by the scoped
report itself, one of two ways: an unsatisfied rule that's IN scope shows up directly in
the printed edge list, marked "NOT satisfied"; anything NOT shown there — an unsatisfied
rule outside scope, or any orphan doc at all (orphans are per-doc facts, never rendered
by this report regardless of scope) — is counted in an explicit "N other coverage
issue(s) not shown above" line. Deliberately scope-neutral wording: an orphan's own
path can itself be one of the changed paths, so a location claim like "outside the
changed path(s)" would sometimes be false.

No effect on any other check, and no effect at all when `checks.coverage` isn't
configured or `--changed` isn't passed — purely additive.
