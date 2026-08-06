---
name: ship
description: Branch, verify, adversarially review, and open a PR for the current work — the enforced path from change to merged PR in this repo. Use when asked to ship, push, or open a PR for finished work.
---

# Ship

Wraps `pnpm ship` (the mechanical steps) with the judgment steps AGENTS.md requires.
Don't skip steps by running the raw commands yourself.

1. **Mechanics**: run `pnpm ship`. It checks `gh`/git auth, rebases onto `origin/main`,
   runs `pnpm verify`, checks for a required changeset, pushes, and reports any existing
   PR. It stops at the first failure — fix and re-run, don't work around it.
2. **New regression test?** Prove RED before GREEN (stash the fix, confirm the test
   fails for the right reason, restore) before this step. `pnpm ship`'s verify pass
   only proves GREEN.
3. **Adversarial review — mandatory, not optional**, unless the change is trivial (typo,
   comment, one-line doc fix). Spawn a fresh agent with the diff and no summary of your
   own reasoning; ask it to find reasons the change is wrong. For a high-stakes or
   uncertain finding, run one review-of-the-review round too — attack the first
   review's completeness, not just the code.
4. **Open the PR** (`gh pr create`) if `pnpm ship` reported none exists. Title and body
   from the real diff and commit history, not a restatement of the request.
5. **End-of-session status** — before finishing, state: what changed, verification
   result (pass/fail), adversarial-review outcome, and the **PR URL if one exists**
   (or "no PR — work not pushed" if not). Never end silently on a PR-producing task.
