# Problem space: root-level docs can't be checked by cairn itself (issue #151)

## The mechanism as it exists today

`cairn check`'s entire generic engine — link resolution (`CheckLinks.ts`), summary
freshness (`CheckSummaries.ts`), and `checks.coverage`/`checks.docCoverage` — only ever
sees files reachable from `config.roots` (default `["docs"]`, this repo's own
`.cairnrc.json`). `roots` is resolved by `expandRoots`/`expandOne` in
[`src/config.ts`](../../../src/config.ts) (`expandOne`/`isDir`):
every candidate path `expandOne` resolves for a pattern is filtered through `isDir` before
being returned —

```ts
const dirs: string[] = []
for (const p of current) {
  if (yield * isDir(p)) {
    dirs.push(p)
  }
}
```

— so a `roots` entry that resolves to a real, existing **file** (not a directory) is
silently dropped, not included and not reported as invalid. `AGENTS.md`, `README.md`, and
`CLAUDE.md` all live at the repo root, outside `docs/`, and are all plain files — so no
`roots` configuration, however written, can ever make cairn's link checker, summary
checker, or coverage checker see them. This isn't a bug in the sense of behaving
differently from its own code; `isDir` does exactly what it says. It's a **gap in what the
primitive can express at all** — a directory-shaped `roots` entry has a path; a file-shaped
one has no representation.

## Real, reproduced evidence, not assumed

Confirmed by running the actual built CLI against this repo, today:

```
$ node dist/cli.js check --root AGENTS.md --links-only
⚠️  No documentation roots found (looked for: AGENTS.md).
✅ Markdown links OK (0 file(s) checked).
```

`AGENTS.md` exists, is 231 lines, and contains real relative links (four to
`docs/incidents/**` subdirectories alone) — none of them checked, because the root
resolved to nothing. This is the same failure mode issue #151 names for `README.md` and
`CLAUDE.md`.

## The failure mode is structural, and it already recurred twice for real

Two independent, already-merged tests hand-roll a narrow content-coverage check to
compensate for exactly this gap, rather than using cairn's own generic engine on itself:

- [`src/jsonIncompatibility.readme.unit.test.ts`](../../../src/jsonIncompatibility.readme.unit.test.ts)
  — asserts every one of the 7 real `--json`-incompatible flags/checks `cli.ts` actually
  registers is mentioned in the specific README paragraph that documents the restriction
  (reading `cli.ts`'s `JSON_INCOMPATIBLE_PLUGINS` registry plus two hand-written CLI
  guards as its source of truth, not a fixed list — its own comment records that an
  earlier, narrower version of this same test nearly shipped checking only the 2
  hand-written cases and missed all 5 registry-based ones).
- [`src/flagReadme.unit.test.ts`](../../../src/flagReadme.unit.test.ts) — walks every
  `Flag.<kind>('name')` declaration in `cli.ts`'s own source via regex and asserts the flag
  is mentioned somewhere in README. Its own header comment records that this test's FIRST
  run (RED, before the fix) found real, pre-existing, undocumented flags in a shipped
  release (`--root`, `--explain`, `--config`, `--threshold`, `--locale`).

Both are real, valuable, already-merged tests that caught real gaps. Neither checks
**links** — both are narrow, hand-written content-coverage assertions, each independently
re-deriving "read the real source of truth, assert it's reflected in the doc," because
`checks.coverage`/`checks.docCoverage` structurally cannot reach `README.md` at all. A
third test, `agentsMdLinks.unit.test.ts` (not present on this branch — proposed in an
unmerged PR, see below), extends the same pattern to actual link
resolution for `AGENTS.md` — but it exists only as an **open, unmerged PR (#148)**, filed
the same day as this finding by the same author. Citing it as a fully independent third
recurrence would overstate the evidence available right now; it's a live proposal
following the same pattern, not proof of a third occurrence. The honest count is **two
confirmed, independent, merged instances of the same root cause**, plus one proposed
extension not yet landed — recorded precisely in
[`docs/incidents/recurrence-gate/three-bespoke-root-doc-checks.md`](../../incidents/recurrence-gate/three-bespoke-root-doc-checks.md),
which this design package treats as its own evidence basis, not a claim manufactured fresh
here.

## Why this is the actual problem, not just "a link could go stale"

The technical symptom is narrow — one un-checked link in `AGENTS.md` would just be a typo.
The real need underneath it is structural: **cairn's own value proposition is "a generic
tool that verifies documentation instead of trusting hand-maintained discipline," and the
project's own root-level instruction files — the docs an AI agent or new contributor
reads FIRST, before anything under `docs/`— are the one place that generic tool cannot
reach.** Every time this gap has been worked around so far, the fix has been a bespoke,
hand-rolled test that re-derives its own notion of "what's the source of truth" and "how do
I compare it to the doc" from scratch — `jsonIncompatibility.readme.unit.test.ts` reads
`cli.ts`'s plugin registry; `flagReadme.unit.test.ts` regexes `cli.ts`'s flag declarations;
a third, proposed one would reuse `extractReferences` but still needs its own bespoke
resolution-base logic outside `checkLinks`. Each is a reasonable, well-tested fix in
isolation. Together, they are the exact anti-pattern cairn exists to prevent: **hand-writing
narrow, one-off enforcement instead of using (or extending) a generic, reusable checker.**
A project that ships a generic documentation-checking tool, and then hand-rolls hand-tests
to check its own most-read documentation because the tool structurally can't, is building
the same disease it's meant to cure — on itself, visibly, in its own test suite.

## Root cause, precisely stated

`roots` (and every downstream consumer built on `expandRoots`'s output — `DocsFs.listFiles`
in [`src/io/DocsFs.ts`](../../../src/io/DocsFs.ts), `checks.coverage`'s glob matching,
`checks.docCoverage`'s `sources`/`coveredBy` groups, `SummaryTree.ts`'s directory-summary
planning) is built on the assumption that **every root is a directory to recurse into.**
`isDir`'s filter isn't a mistake; it's the necessary consequence of that assumption. There
is no representation anywhere in the pipeline for "this one specific file, checked
directly, with nothing to recurse into."

## Evidence basis — stated plainly

This design rests on [issue #151](https://github.com/sledorze/cairn/issues/151), filed by
cairn's own maintainer, which itself points to the recurrence-gate finding above as its
evidence. As with `docs/design/101-refs-symbol-scoping/`'s own honest evidence-basis
section, this is **maintainer-self-reported, not externally corroborated** — there is no
open-source user request for this, no second party's issue. What makes it more than a
single anecdote is the same thing `docs/incidents/recurrence-gate/three-bespoke-root-doc-checks.md`
already establishes: **two independently-written, already-merged tests hit the identical
root cause on two different occasions**, months apart in this repo's own history
(`jsonIncompatibility.readme.unit.test.ts` and `flagReadme.unit.test.ts` were written
separately, by the same author, but each time re-discovering the same gap rather than
reusing a prior fix — itself evidence the gap has no existing generic answer to reach for).
That is a real, if narrow, recurrence signal — not widespread demand, but not a one-off
either. [`spikes.md`](./spikes.md) confirms this claim isn't just a code read, either —
Spike 1 reproduces today's failure by actually running the built CLI, and Spike 2 disproves
the one workaround that looked like it might avoid needing a design at all.

## Constraints on any solution

1. **Never widen what cairn reads beyond what `roots` explicitly names.** A file-shaped
   root is still a root — the existing `assertNoRootEscape`/`isSafelyWithinBase`
   containment discipline (`config.ts`, `io/DocsFs.ts`) must keep applying to it exactly
   as it does to a directory-shaped root today. No new, unaudited read path.
2. **Backwards compatible.** Every existing directory-shaped `roots` entry must keep
   working identically; a file-shaped entry is purely additive.
3. **Must not silently pull `AGENTS.md`/`README.md`/`CLAUDE.md` into obligations that were
   never asked for.** Adding a file to `roots` for link-checking must not, as an
   unannounced side effect, suddenly require a `.summary.md` sibling for a 231-line root
   instruction file, or start demanding `checks.coverage`/`checks.docCoverage` obligations
   against it. Whether — and how — a file-root opts out of those is a real design
   question this package must answer explicitly (see `solution-space.md`,
   `roadmap.md`), not leave implicit.
4. **No new bespoke test.** The whole point of this design is to stop adding a fourth
   hand-rolled root-doc check — the fix must route through cairn's own existing generic
   engine (`checkLinks`, at minimum), not add a fifth narrow assertion library.
5. **`--refs` is explicitly out of scope here.** `docs/design/101-refs-symbol-scoping/`
   already covers `--refs`'s own, unrelated granularity problem; this design is about
   `roots` reaching root-level files at all, a prerequisite `--refs` would also benefit
   from later, but not something this package needs to solve.
