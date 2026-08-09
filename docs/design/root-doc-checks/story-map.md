# Story map: issue #151 (root-level docs reachable by cairn)

Backbone = a maintainer's actual workflow editing a root-level instruction file, left to
right. Each column's cards are ordered top-to-bottom by priority; the horizontal line
marks the walking-skeleton release.

## Backbone

`Edit AGENTS.md/README.md/CLAUDE.md` → `Add or change a link` → `Run local checks / open a
PR` → `CI runs cairn check` → `Decide: does the broken link get caught?` → `Fix or merge`

## Cards, by backbone step

### 1. Edit a root-level doc

- _As a maintainer, editing `AGENTS.md` to add a new incident cross-reference is an
  ordinary doc edit_ — no different in kind from editing anything under `docs/`, even
  though today cairn treats it completely differently (invisible vs. checked).
  **(Release 1 makes this true.)**

### 2. Add or change a link

- _As a maintainer, when I add `[x](docs/incidents/y/)` to `AGENTS.md`, I want the same
  guarantee I already get for a link inside `docs/architecture.md`_ — that a typo'd path,
  a moved directory, or a renamed file is caught before merge, not discovered by a reader
  clicking a dead link. **(Release 1, the headline story.)**
- _As a maintainer, I do NOT want adding `AGENTS.md` to `roots` to suddenly require a
  `AGENTS.md.summary.md` sibling or trip `checks.coverage`'s design-package rules_ — a
  231-line instruction file gaining an unwanted, unrelated summary-freshness obligation as
  a side effect of fixing its LINKS would be a surprising, unasked-for regression, not a
  fix. **(Release 1 must explicitly NOT do this — see `roadmap.md`'s scoping decision.)**

### 3. Run local checks / open a PR

- _As a contributor, I want `pnpm check` (or whatever local command already runs `cairn
check`) to keep working exactly as it does today for the `docs/` tree_ — this design
  adds a root-file check, it does not change or slow down the existing one.
- _As a maintainer, I want the root-file check to be its own clearly-named step, not
  silently folded into the existing one_ — so a CI failure says "AGENTS.md has a broken
  link," not an ambiguous failure inside a run whose name still says `docs/`.

### 4. CI runs `cairn check`

Non-negotiable engineering constraint, kept here (not "as a [role]" phrasing) because it
attaches to this exact backbone step and a CI pipeline isn't a persona whose journey this
map otherwise traces:

- A file-shaped root must go through the exact same containment guarantees
  (`assertNoRootEscape`, `isSafelyWithinBase`) a directory-shaped root already does — no
  new, less-audited read path introduced just because the shape is different.

### 5. Decide: does the broken link get caught?

- _As a maintainer, today: nothing catches a broken link in `AGENTS.md` automatically —
  someone eventually notices by hand, or one of the two existing bespoke tests happens to
  cover the SPECIFIC thing that changed (a flag name, a `--json` incompatibility), which
  neither one does for an arbitrary link._ This is the reported pain, restated as what
  actually happens today, not what should happen.
- _As a maintainer, after this fix: `pnpm check` (or CI) catches it automatically, the
  same way it already does for any doc under `docs/`_ — the actual success criterion for
  this whole issue.

### 6. Fix or merge

- _As a maintainer, once Release 1 ships, PR #148's `agentsMdLinks.unit.test.ts` becomes
  redundant with a real, generic check_ — I want it closed/superseded, not left running
  forever as a second, parallel, narrower mechanism nobody remembers to keep in sync with
  the generic one. **(Roadmap's explicit migration note.)**

## Walking skeleton (the line above marks it in each column)

Release 1 — `roots` accepting a literal file entry, consumed via a second, `--links-only`,
root-file-scoped `cairn check` invocation (solution-space's synthesis of options 1 + 4) —
is the walking skeleton: it ships end-to-end (config → CLI → real link-check output),
directly resolves the reported pain (a broken link in `AGENTS.md` now fails `cairn check`),
and deliberately does NOT yet extend summaries/coverage to root files — narrower than the
eventual full picture, but the smallest slice that's actually shippable and genuinely fixes
what issue #151 reports.
