# Incident: `git checkout --` discarded a real implementation, not just its mutation

## What happened

Proving a new test RED-before-GREEN: mutate the implementation to disprove the claim, run
the test, confirm it fails for the right reason, then restore. The implementation
([`checkRefs`](../../../src/program/links/CheckRefs.ts)) had never been `git add`ed — the
mutation and the real, unstaged implementation were both wiped by `git checkout -- <file>`,
which restores the INDEX (the last commit), not the working tree's last edit. Recovering
cost a full re-write of the feature.

## Root cause

`git checkout -- <file>` is not "undo my last edit" — it's "discard everything since the
index." An unstaged real change and an unstaged mutation are indistinguishable to it.

## Fix

Stage the real implementation (`git add`) BEFORE mutating it for a RED proof. Restore with
`git restore --worktree -- <file>` afterward, which correctly comes back to the staged
(real) version, not the last commit.

## Rule this produced

See `AGENTS.md`'s "RED before GREEN" rule.
