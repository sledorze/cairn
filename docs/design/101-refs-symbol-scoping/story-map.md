# Story map: issue #101 (`--refs` granularity)

**What this map actually is** (required, verbatim, across every design package's
story-map.md — this convention's own requirement): every role below is an internal
engineering role (doc author, reviewer, CI), not a customer or market segment. This
repo's design-package docs are dev-shaped content, not product/market research, despite
borrowing product vocabulary in their filenames (`story-map.md`, `roadmap.md`) — see
`docs/design/CONVENTION.md`'s own "judging this convention" section. A real relationship
with ANOTHER package (not an internal role within this one) belongs in
[`../dependencies.md`](../dependencies.md), not here.

Backbone = the doc author's actual workflow with `--refs`, left to right. Each column's
cards are ordered top-to-bottom by priority; the horizontal line marks the walking-skeleton
release (the smallest slice that's shippable and actually fixes the reported pain).

## Backbone

`Cite implementation from a doc` → `Stamp current state` → `Edit the cited code` →
`Re-run --refs` → `Decide: does this drift matter?` → `Re-stamp or investigate`

## Cards, by backbone step

### 1. Cite implementation from a doc

- _As a doc author, I cite a whole file when the file's entire content IS the claim_
  (e.g. a config example, a small self-contained script) — **existing behavior, unchanged,
  must keep working identically.**
- _As a doc author, I want to exempt specific cited files/globs from `--refs` scanning
  entirely_ so a leaf file I cite for illustration only never generates noise. _(Release 1)_
- _As a doc author, I want to cite one exported symbol specifically_ (`#checkFile`) so a
  reader — and `--refs` — both know exactly what claim the citation makes. _(Release 3)_

### 2. Stamp current state

- _As a doc author, running `--refs --stamp` after authoring a citation records what "the
  cited thing" means today_ — unchanged mechanism, but the UNIT of what's hashed changes
  per release below.
- _As a maintainer, I want `--stamp` to tell me when a `unit`/scope config change means
  every existing sidecar is about to be recomputed_ (a one-time, expected mass-restamp,
  not a silent behavior change nobody notices) — see `roadmap.md`'s migration note.

### 3. Edit the cited code

- _As a contributor, editing a private helper inside a file whose EXPORTS a doc cites
  should NOT fail `--refs`_ — this is the issue's own headline complaint. _(Release 2,
  fully addressed; Release 1 addresses it only for exempted files)_
- _As a contributor, editing/adding/removing an EXPORTED declaration a doc's citation
  covers SHOULD fail `--refs`_ — the check must still catch what it exists to catch;
  precision must never become "nothing fails." _(Release 2)_
- _As a contributor, renaming an exported symbol a doc cites by name (`#checkFile`) should
  produce an actionable, specific error_ ("citation target `checkFile` no longer exists in
  `engine.ts` — did you mean `checkFileContents`?"), not a silent false-pass or an opaque
  hash mismatch. _(Release 3, the harder half of option A per `problem-space.md`'s
  constraint 1 — a MISSING anchor must never resolve to "nothing to compare, so pass.")_

### 4. Re-run `--refs`

Non-negotiable engineering constraints, not user stories — kept here (not in a persona
format) because they attach to this exact backbone step and belong in the map even though
"a CI pipeline" and "a security reviewer" aren't the doc author whose journey this map
otherwise traces. Forcing these into "as a [role], I want" phrasing would inflate the map's
apparent user-discovered value without actually discovering anything new:

- `--refs` must behave identically for `git ls-files`-tracked vs. untracked targets under
  `onlyGitTracked` — matches `CheckRefs.ts`'s already-established `trackedFiles` handling;
  no NEW gap for any new `unit` to introduce.
- A new `unit`/scope must never widen what `--refs` reads outside `base` — every new code
  path re-uses `isSafelyWithinBase` (`resolveReferenceContent`'s own existing guard), not a
  new, unaudited read path.

### 5. Decide: does this drift matter?

- _As a doc author, `checkRefs`'s report should say WHAT changed, not just THAT it
  changed_ — today's `StaleRef` (`CheckRefs.ts:50-54`) already carries an optional
  `anchor` alongside `currentHash`/`recordedHash`, but nothing yet names WHICH export(s)
  changed within a multi-export file; with export-surface hashing (Release 2), the report
  can add that (a real, cheap upgrade once the hash is computed per-export instead of once
  per file — see `implementation-details.md`).
- _As a doc author who's just been shown "3 unrelated files, same one-line internal
  change, still all green," I should be able to verify that for myself_, not just trust
  the tool — this is `roadmap.md`'s own falsification requirement for the release, mirrored
  from every other check this repo has shipped.

### 6. Re-stamp or investigate

- _As a maintainer, `--stamp` after a real export-surface change should feel like signing
  off on a genuine review moment, not a reflex_ — this is the actual success criterion for
  the whole issue: re-stamping stops being noise-driven.

## Walking skeleton (the line above marks it in each column)

Release 1 (`sources`/`exempt`-style config scoping, solution-space option D) is the
walking skeleton: it ships end-to-end (config → CLI → sidecar → report), fully resolves
the reporter's OWN specific repro (exempt the 14 leaves, `--refs` only watches the facade
files if any exist, or simply stop scanning the noisy leaves at all), and needs zero new
parsing dependency — the fastest path to "the reported pain is gone," even though it's not
yet the general per-symbol/per-export precision the later releases add.
