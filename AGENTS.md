# AGENTS.md

<!-- cairn:start -->

# Documentation summary convention

This repo enforces a **hierarchical, content-hashed documentation summary** tree.
CI runs `cairn check` and **fails the merge** if any summary is missing,
stale, or a link is broken. Treat green `check` as a hard requirement, not a nicety.

## The invariant

1. **File summaries** — every Markdown file longer than the threshold (default 30
   lines) has a sibling `X.summary.md`: a fast-to-read digest of the CURRENT content
   of `X.md`.
2. **Directory summaries** — every in-scope directory has a `_SUMMARY.md` that
   aggregates its direct docs (each doc's `.summary.md` if the doc is big, else the
   doc itself) plus the `_SUMMARY.md` of each direct sub-directory. It links to
   **every** direct child file and sub-directory (link-completeness).
3. **Freshness by content hash, tracked OUTSIDE your docs** — each summary's hash is
   recorded in a hidden sidecar under `.cairn/`, one JSON file mirroring each summary's
   path (e.g. `.cairn/docs/a.summary.md.json`). The checker recomputes the source hash
   and compares it to the sidecar; mismatch = stale, absent = missing. This survives git
   clone and CI (mtime does not), and it means the tracking system leaves **zero bytes**
   in the docs you write — no stamp comment to see, ignore, or accidentally hand-edit.
   Commit `.cairn/` alongside your docs; it's not gitignored.
4. **Bottom-up in one pass** — a directory summary hashes a manifest of its children's
   hashes (a Merkle tree), so (re)write leaves-first: file summaries, then directories
   deepest-first, then stamp.
5. **Deletions are caught too** — a sidecar left behind with no matching doc (its source
   was deleted or renamed) is flagged as a deleted-source stamp; `--prune` removes both
   the leftover summary and its sidecar.

## Upgrading from an older cairn (legacy `<!-- source-sha256 -->` stamp)

**Nothing special to do — do not go looking for a migration step.** If a summary still
carries the old in-content `<!-- source-sha256: ... -->` comment, the ordinary stamp
command (`npx cairn check --summaries-only --stamp`) strips it and writes the
`.cairn/` sidecar in the same run, automatically. There is no separate command to
discover or remember: whatever `stampCommand` this repo already runs already does it.
(`--migrate-stamps` also exists, purely as an optional explicit/reportable alias for
the same self-healing behaviour — never required.)

## Workflow when you edit docs

When you create or edit any doc:

1. If the doc is longer than the threshold, create or update its `X.summary.md` to
   reflect the new content.
2. Update the `_SUMMARY.md` of every affected directory, walking **up** the tree
   leaves-first, and keep a link to every child file and sub-directory.
3. Run this repo's configured stamp command (`stampCommand` in `.cairnrc.json`) to
   (re)write the sidecar hashes under `.cairn/` bottom-up. That's currently `pnpm
format && npx cairn check --summaries-only --stamp` — format first, since stamping
   before a later reformat hashes content the format step is about to change.
4. Run `npx cairn check` and ensure it exits 0 (green) before you finish.
5. Commit your doc changes **together with** the `.cairn/` sidecar changes — a doc
   edit without its matching sidecar update is exactly what `check` is designed to catch.

## Commands

- `npx cairn check` — check summaries + links (exit 1 on any problem).
- `npx cairn check --summaries-only` / `--links-only`.
- `npx cairn check --links-only --fix` — auto-repair unambiguous dead links.
- `npx cairn check --summaries-only --stamp` — write the `.cairn/` sidecar hash of
  EXISTING summaries bottom-up. It does **not** author prose; you write the content,
  then stamp.
- `npx cairn check --prune` — delete orphan summaries and orphan `.cairn/` sidecars
  (source doc deleted, renamed, or below threshold).
- `npx cairn check --migrate-stamps` — optional: the same self-healing `--stamp`
  already does for a legacy in-content stamp, as its own named/reported step. Never
  required.

## Other opt-in checks (all off by default — see the README for full details)

- `--refs` (with `--stamp`) — tracks the _content_ of what a link points to, not
  just whether it resolves: `--refs --stamp` records a hash of every reference
  target; a later `--refs` run reports any that changed since.
- `--prose-refs` — safe for permanent, ongoing use (not just a one-time migration
  step): flags a bare-backtick file citation in prose (e.g. a citation with no
  `[text](path)` syntax) whose target does not resolve. Silent for anything that
  does. It's a live existence check with no history — it can't tell a real
  citation that was moved/deleted from a path-shaped example that was never a
  citation at all; use `checks.proseRefs.ignore` in config to exempt the latter
  (e.g. a documented sample path in a table).
- `checks.coverage` (config only, no CLI flag) — for docs beyond code reference
  (PRDs, specs, decision logs): declares doc **kinds** by path glob and **rules**
  ("every `feature` doc must link to a `decision` doc"), then reports missing
  links and orphaned docs. Catches something the checks above can't: a repo can have
  zero broken links and still have unrelated feature/decision docs that were never
  actually connected. Worth checking for if you're asked to organize product
  knowledge, not just code docs.
- `--report-deletions` (with `--deletions-since <ref>`, default `HEAD`) —
  informational only, never affects exit code: when a doc has disappeared since
  that ref, reports which of its headings/outbound links appear in NO remaining
  doc — a lossy deletion or consolidation the checks above can't see, since
  everything that remains stays internally consistent. Worth running before
  deleting a doc you believe is pure duplication.

You author the prose. The tool only verifies and stamps — and it never touches your prose to do it.

<!-- cairn:end -->

# Maintaining this file

Everything below `<!-- cairn:end -->` is hand-authored, not cairn-generated — it loads into
every session's context regardless of relevance, so keep it lean. Per Anthropic's own
guidance ([Claude Code best practices](https://code.claude.com/docs/en/best-practices)):
"For each line, ask: would removing this cause Claude to make mistakes? If not, cut it" —
a bloated file causes Claude to ignore the rules that matter.

When adding a rule: state it, then ONE clause of concrete evidence (a file:line, a
function name, a one-sentence incident) — not a paragraph of narrative setup. When editing
an existing rule, tighten rather than append. Re-justify the file's length the same
adversarial way periodically, not by self-assessment — this file was cut 33% (308→231
lines) doing exactly that once; it can drift back up the same way it grew.

**A new incident for an EXISTING rule goes in `docs/incidents/<rule-category>/` — never as
new inline text here.** Add the file, link it from that subdirectory's own `_SUMMARY.md`;
this file's own link (already pointing at the subdirectory) needs no edit. Only a genuinely
NEW rule, or a new category of mistake, touches this file at all — that's the whole point:
the incident count grows in `docs/incidents/`, this file doesn't grow with it.

# Release convention

Releases are automated via [Changesets](https://github.com/changesets/changesets) (see
`.github/workflows/release.yml`) — merging to `main` with unconsumed `.changeset/*.md`
files opens a "Version Packages" PR (bumped `package.json`, generated `CHANGELOG.md`);
merging that PR publishes to npm, pushes the git tag, and creates a GitHub Release.

If your PR is a user-facing change (not docs-only, not internal tooling with no effect
on the published package), run `pnpm changeset` and commit the generated file alongside
your change. Not enforced by CI — a missing changeset just means that change won't show
up in the next changelog, not a build failure.

## Reviewing the "Version Packages" PR before merging it

Merging it is irreversible in effect — it publishes to npm and cuts a GitHub Release, not
just a git merge. Verify each unconsumed changeset individually before merging, not just
that the diff looks mechanically correct:

- **A changeset's wording ships to the CHANGELOG verbatim** — re-verify every factual claim
  against CURRENT code first. Incident: a changeset once understated a restriction ("no
  leading `../`" when the real check exempted a `..` segment anywhere).
- **An unrelated PR's incidental behavior change still needs its own changeset,
  retroactively.** Incident: a `config.ts` Effect-conversion refactor once carried a real,
  unflagged, user-facing stricter symlink-escape check.
- **Check for a redundant open PR before merging a changeset that auto-closes its issue** —
  GitHub auto-closes the referenced issue on merge. Incident: two independent PRs once fixed
  the same filed issue days apart. `gh issue view <n>` / `gh pr list` before merging.
- **A new restriction must be discoverable, not just correct** — confirm
  `schema/cairn.schema.json` (from `Config.ts`'s `Schema.annotate`) and `--help` mention it,
  not just the changeset/README.

# `--refs` is enforced here, not just available

`pnpm check` runs `cairn check --refs` — NOT scoped to `docs/architecture.md` alone.
`docs/adr/**` and `docs/design/**` cite real `src/**` files directly too (`git grep -l
'\.ts)' docs/adr docs/design` finds them). Editing ANY cited file needs `pnpm run
stamp:refs`, or `pnpm check` fails — the failure message itself now names the fix command.
Dogfooded for real: `.cairn/refs/**` sidecars sat stale for years before this was turned on
(nothing ran `--refs` at all); editing a cited file without re-stamping fails `pnpm check`
(confirmed), same as any other stale summary.

# Content-mutation safety (writing to files this codebase doesn't fully own)

Any write-back to a user-authored file (not a `.cairn/**` sidecar, not a build artifact)
must scope which files it's allowed to touch **structurally** (path/role classification),
never by content-pattern match alone — a doc can legitimately contain the exact pattern
you're matching (e.g. one documenting cairn's own stamp format).

Incident: `CheckSummaries.ts`'s `stampFiles` once stripped a legacy
`<!-- source-sha256 -->` comment from any file matching `HASH_RE`, with no check the file
was actually a summary — silently deleting it from a source doc that discussed the format.
Fixed by requiring `isSummaryFile(p, naming) || isDirSummary(p, naming)` first.

Model to match: `CheckLinks.ts`'s `--fix` only mutates a link target recovered via
structured extraction (`extractLinks`), and only once `applyFix` confirms it unambiguous —
never "find this pattern anywhere and replace it."

New write path? Ask "what stops this from firing on an unintended file?" — "the content
matched" isn't an answer. Pair the fix with a negative test proving an adjacent, similar
file is left untouched (see `CheckSummaries.unit.test.ts`).

# Shipping one iteration well

No `CONTRIBUTING.md` exists; this section covers idea → merged PR. Every rule below is a
concrete lesson from a real incident, not aspirational advice.

Use the `ship` skill (`.claude/skills/ship/`, wraps `pnpm ship`) to run this — one enforced
path, not two copies to keep in sync.

**Full local verify before every push, every time.** `pnpm verify` (lint+typecheck+test+
build+check). `lefthook.yml` automates most of this on `pre-commit`/`pre-push`, but hooks
are skippable (`--no-verify`) and can't construct the scenario a feature is meant to catch —
treat them as backstop, not practice. Incident: `RefStore.ts` once silently clobbered an
unrelated summary sidecar on first real run, with `tsc`/`vitest` green throughout — only
running the real CLI caught it.

**`pnpm coverage`'s auto-raised thresholds (`vitest.config.ts`) are a real diff to commit,
not a side effect to ignore.** The tool prints "you may want to push with updated coverage
thresholds" for exactly this reason — it's a hint, not a formality. `git status` after
`pnpm ship` before considering a push done. Incidents:
[`docs/incidents/verify-before-push/`](docs/incidents/verify-before-push).

**Dogfood the actual CLI before calling a feature done — passing unit tests are necessary,
not sufficient.** Build and run it for real: construct the exact scenario the feature
should catch, confirm it's reported, revert, confirm clean. Every check-detection feature
here (`CheckLinks.ts`, `CheckRefs.ts`) had a real gap — a blank field, a crash, a false
negative — that only dogfooding found.

**Convert every manual dogfooding proof into a permanent test.** A bug found and fixed by
hand with no test added can silently come back. Pattern that's worked: a real temp dir
(`src/testSupport/tempProject.ts`), BEFORE/AFTER — assert clean, mutate on real disk,
assert the break is caught, revert, re-assert clean. Prefer this over an in-memory double
alone when the thing under test is real filesystem behavior (path resolution, sidecar
placement, hashing).

**RED before GREEN for any new test, not just regression tests.** Prove it fails against
the thing it claims to catch before trusting it green — `git stash` the fix (or comment out
the feature), rerun, confirm it fails for the right reason, then restore. Incident: a
`--json`-incompatibility test once only checked "the flag's name appears somewhere in
README" — trivially true even with the incompatibility undocumented, since the same names
appear elsewhere as ordinary references. **Stage the real implementation before mutating it
for this** — `git checkout -- <file>` restores the INDEX, not your last edit; done on an
unstaged file it silently discards the real fix along with the mutation; `git add` the real
change first, then mutate, then `git restore --worktree` to come back. Incidents:
[`docs/incidents/red-before-green/`](docs/incidents/red-before-green).

**Run an adversarial review, from an unbiased sub-agent, before every push — "just a test
file" is not the trivial exception.** The author is the worst-positioned reviewer — they
already believe the fix is correct. Spawn a fresh agent with just the diff, no summary of
your own reasoning, and ask it to find reasons the change is wrong. Distinct from
dogfooding: dogfooding proves the fix catches what it's meant to; adversarial review checks
for what you didn't think to test. Skippable only for a genuinely trivial change (typo,
comment, one-line doc fix) — NOT "I only added a test," which still needs review of what the
test actually proves. Incidents:
[`docs/incidents/adversarial-review/`](docs/incidents/adversarial-review).

**Before designing a new capability, run a cheap recurrence gate first; save the full ROI
attack for after a concrete design exists.** "Has this happened more than once,
independently?" is answerable before any design work and kills a true one-off cheaply.
Don't front-load the full cost attack — cost is a property of the specific design, not the
abstract problem. Incident: this repo's `checks.claims` episode spent two turns on design
before an ROI attack (on the now-concrete design) reversed the pick; a one-line prevalence
check up front (the bug had occurred once, self-found, in the same session proposing the
fix) would have flagged it sooner.

**For a high-stakes or uncertain finding, run at least one review-of-the-review round** —
attacking the previous review's _completeness_, not the code. Incident: this repo's own
README review needed a second round to catch it was itself incomplete (2 of 7 real `--json`
cases found), a third round to catch an RCE risk in the safety-approved design that round
missed, and a fourth to catch that even the safety-approved pick wasn't worth building.
"What would make your last answer wrong?" surfaced each miss — a second identical review
pass would not have.

**Treat a structural/architectural claim in a doc as unverified until grepped, not just
re-read.** This repo has caught real drift here twice (undocumented files after a feature
PR; a mutual dependency between two directories meant to be one-directional). Verify by
construction: grep every import, confirm every doc-linked path resolves. For anything you
can't self-check neutrally, get an independent read from a fresh subagent.

The same trap applies to a review's own evidence: a cited line range (e.g.
`cli.ts:223-233`) is an unverified completeness claim, not a boundary. Incident: this
repo's own README review cited that range for "2 `--json` conflicts" and never grepped past
it, missing a 5-entry registry (`JSON_INCOMPATIBLE_PLUGINS`) that raised the real count to 7. Grep for the enclosing declaration (registry, array, enum) before trusting a line-range
citation as the full extent.

**One logical concern per PR, based on the right parent branch — check `git branch
--show-current` before a new task's first commit, never assume the checked-out branch is
right.** If B genuinely depends on A landing first, branch B off A, not off `main`; new,
unrelated work never piles onto whatever branch happens to be checked out, even one with an
open PR already. Small, focused PRs are also what makes a full verify + dogfooding pass fast
and legible on one concern instead of easy to skim past on five. Incidents:
[`docs/incidents/branch-hygiene/`](docs/incidents/branch-hygiene).

**A changeset for every user-facing change** — written for someone who'll never read the PR
description: what changed, and whether it can flip a previously-passing repo to failing (a
stricter check is a real behavior change, not just a bugfix).
