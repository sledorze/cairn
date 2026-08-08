# Incident: an unrelated feature was built directly on a docs-only PR's branch

## What happened

A real production feature (`refs.scope`, ADR 0004 Release 1) was implemented and committed
directly onto the branch backing an already-open, docs-only PR (#137's design package),
instead of starting a fresh branch off `main`. The PR's own title and description ("docs
only; no production code changes; empty changeset") went stale mid-flight — a reviewer
reading it would have no idea a real feature, schema change, and minor version bump were
also in the diff.

## Root cause

The branch that happened to be checked out was assumed to be the right base for new,
unrelated work, without checking `git branch --show-current` or considering whether the work
depended on what was already on that branch (it didn't).

## Fix

Split apart after the fact: created a safety branch with everything, reset the original
branch back to its pre-session tip (`git reset --hard` + `--force-with-lease` push,
restoring the original PR), then cherry-picked the feature's commits onto a fresh branch off
`main` for its own PR. Recoverable, but avoidable — a normal two-branch start from the
beginning would have cost nothing extra.

## Rule this produced

See `AGENTS.md`'s "One logical concern per PR, based on the right parent branch" rule.
