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
