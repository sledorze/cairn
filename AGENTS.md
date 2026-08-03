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
3. Run the stamp command to (re)write the sidecar hashes under `.cairn/` bottom-up:
   `npx cairn check --summaries-only --stamp`.
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
  `[text](path)` syntax) whose target has moved or been deleted. Silent for
  anything that still resolves.
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

# Release convention

Releases are automated via [Changesets](https://github.com/changesets/changesets) (see
`.github/workflows/release.yml`) — merging to `main` with unconsumed `.changeset/*.md`
files opens a "Version Packages" PR (bumped `package.json`, generated `CHANGELOG.md`);
merging that PR publishes to npm, pushes the git tag, and creates a GitHub Release.

If your PR is a user-facing change (not docs-only, not internal tooling with no effect
on the published package), run `pnpm changeset` and commit the generated file alongside
your change. Not enforced by CI — a missing changeset just means that change won't show
up in the next changelog, not a build failure.

# Content-mutation safety (writing to files this codebase doesn't fully own)

Any code path that WRITES BACK to a file the user authored — not a `.cairn/**` sidecar,
not a build artifact, an actual doc/source file — must scope _which files it's allowed to
touch_ structurally (by path/role classification: is this a summary? a managed artifact?),
**never by a content-pattern match alone**. A regex/string match against file content can
legitimately fire on a file that isn't the kind of file the operation is meant for — e.g. a
doc that _documents_ one of cairn's own formats, with a real-looking example of it in prose.
Scoping by content alone will silently mutate that doc's real, authored content, which is
exactly the "silently checks/changes the wrong thing" failure class this whole tool exists
to prevent, now committed by the tool itself.

Concrete incident this rule generalises from: `CheckSummaries.ts`'s `stampFiles` originally
stripped a legacy `<!-- source-sha256 -->` comment from **every** markdown file it read,
scoped only by "does the content match `HASH_RE`" — with no check that the file was actually
a summary. A source doc whose own prose legitimately contained that exact comment (e.g. one
explaining cairn's old stamp format) had it silently deleted by an ordinary `--stamp` run.
Fixed by additionally requiring `isSummaryFile(p, naming) || isDirSummary(p, naming)` before
ever stripping — content-pattern match is necessary, never sufficient, to justify a write.

The positive example already in this codebase: `CheckLinks.ts`'s `--fix` never scans file
content for a bare pattern — it rewrites only a specific link's target, recovered via
_structured_ extraction (`checkContent`/`extractLinks`) and only when the replacement was
independently verified unambiguous (`applyFix`). That's the shape to match: identify the
exact structural element you're allowed to touch first, then mutate only that, never "find
this pattern anywhere and replace it."

**When you add or review any new write path** (a new `--fix`-like flag, a new migration, a
new auto-repair): ask "what stops this from firing on a file it wasn't meant for?" If the
answer is only "the content happened to match," that's not yet a real answer. And pair the
fix with a NEGATIVE test — not just "the target file gets fixed correctly," but "an
adjacent, superficially-similar file is provably left untouched" (see
`CheckSummaries.unit.test.ts`'s "never strips the legacy pattern from a SOURCE doc" test for
the pattern to copy).

# Shipping one iteration well

No `CONTRIBUTING.md` exists, and the "Release convention" section above only covers
changesets — neither says how to actually take a change from idea to merged PR. This section
does. It's not aspirational: every rule below is a concrete lesson, distilled from real
incidents that a lighter process missed.

**Full local verify before every push, every time — not just before "done."**
`pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm check` (`pnpm verify` runs
all five). `lefthook.yml`'s hooks already automate most of this — `pre-commit` runs
lint/format, `pre-push` runs typecheck+test+build, then `check`, then the perf-regression
gate — but that's not a reason to treat it as covered: hooks are skippable (`git ... --no-verify`),
and no hook can construct the actual scenario a feature is meant to catch for you (see
"Dogfood," next). Treat the hooks as the backstop, not the practice. A change that "obviously
can't affect X" still gets the full pass regardless: the reference content-hash tracking
feature (`RefStore.ts`) silently clobbered an unrelated summary sidecar the first time it ran
for real — `tsc`/`vitest` were both green throughout, because nothing in the type system or
the unit tests encoded "these two sidecar kinds must never share a path." Only running the
real CLI against the real repo caught it.

**Dogfood the actual CLI against the actual repo before calling a feature done — unit tests
that pass are necessary, not sufficient.** Build `dist/cli.js` (or run via `tsx`) and run it
for real, including the negative case: construct the exact scenario the feature is meant to
catch (a renamed file, a reworded heading, a changed reference target), confirm it's
reported, then revert and confirm it's clean again. Every check-detection feature in this
repo (`CheckLinks.ts`'s anchor/cross-hierarchy validation, `CheckRefs.ts`'s drift tracking)
had a real gap that only showed up this way — a blank error-report field, a crash on an
unusual link shape, a false negative on a multi-reference doc — never caught by `tsc` or a
unit test written before the dogfooding pass found the gap.

**Convert every manual dogfooding proof into a permanent test before moving on.** A bug you
found by hand and fixed, with no test added, is a bug that can silently come back. The
pattern that's worked repeatedly here: a real temp directory (`src/testSupport/tempProject.ts`),
BEFORE/AFTER structure — assert clean, mutate a file on real disk exactly like a later commit
would, assert the specific break is now caught with real (not placeholder) detail, then
revert and re-assert clean. Prefer this over the in-memory test double alone when the thing
under test is specifically about real filesystem behaviour (path resolution, sidecar
placement, content hashing) — the in-memory double is faster and still worth keeping
alongside it, but it can't catch what only the real `DocsFsLive` binding exercises.

**Run an adversarial review, from a purposely unbiased sub-agent, before every push.** The
author of a change is the worst-positioned reviewer of it — they already believe the fix is
correct, so they re-read their own reasoning instead of checking it. Before pushing, spawn a
fresh agent with no prior context on the change (a plain diff/PR description, not a summary of
your own reasoning) and ask it to find reasons the change is wrong, not to confirm it's right —
try to break the fix, not tour it. This is a distinct step from "Dogfood" and "Convert every
manual proof into a test" above: dogfooding proves the fix catches what it's meant to; an
adversarial review checks for what you didn't think to test, an edge case the fix doesn't
cover, or a regression it silently introduces elsewhere. Skippable only when the change is
trivial (a typo, a comment, a one-line doc fix) — anything touching behaviour, a check's
detection logic, or a write path gets the review.

**Treat a structural/architectural claim in a doc as unverified until grepped, not just
re-read.** "The architecture doc reflects the code" and "these two modules don't depend on
each other" are exactly the kind of claim that silently rots as a codebase grows — this repo
has caught real drift here twice (undocumented files after a feature PR; a mutual dependency
between two directories that were supposed to be one-directional). Verify by construction:
grep every import, confirm every doc-linked path resolves, confirm every real source file is
named somewhere. For anything you can't easily self-check (you wrote both the code and the
doc, so you're not a neutral reader of either), get an independent read — a fresh subagent
with no context beyond "verify this claim," not a re-read of your own reasoning.

**One logical concern per PR, based on the right parent branch.** If work B genuinely
depends on work A landing first (A fixes a doc that B's own changes then build further on),
branch B off A's branch, not off `main` — don't let a dependent change get PR'd against a
`main` that doesn't have the prerequisite yet. Small, focused PRs are also what makes the
rest of this section practical: a full verify pass and a dogfooding pass are fast and legible
on one concern, and slow and easy to skim past on five.

**A changeset for every user-facing change** (see "Release convention" above) — and write
its summary for someone who will never read the PR description: what changed, and whether
it can flip a previously-passing repo to failing (a new check getting stricter is a real,
sharp-edged behaviour change, not just a bugfix, even though it "only" makes `cairn` more
correct).
