# Knowledge / skill: extending `--refs` granularity (issue #101)

A distilled how-to for whoever (human or agent) picks up Release 1/2/3 from
`roadmap.md` — the reusable technique this design surfaced, not a restatement of the
other docs. Read `problem-space.md` → `solution-space.md` →
`docs/adr/0004-refs-scoped-hashing-granularity.md` first for WHY; this doc is HOW to keep
extending it correctly.

## The one invariant every release must preserve

**A `unit` config change must never silently make `--refs` MORE lenient than a user
would expect from reading their own config.** Concretely: a target that WOULD have
reported drift under `whole-file` must still report drift under `exports-only` if the
drift touches an exported declaration. The failure mode to fear isn't "too noisy" (that's
the bug this design fixes) — it's "quietly stopped catching real drift," which is worse and
harder to notice (mirrors `docs/adr/0002-coverage-orphan-check-scoped-to-declared-to-kinds.md`'s own orphan-scoping discipline: precision errors
toward "still catches the real thing"). Any new `unit` value added after this design must
be checked against this invariant with a real integration test BEFORE it ships, not
inferred from the implementation looking plausible.

## How to validate a claim in this design before trusting it

**This design's own adversarial review found three of its OWN claims wrong on first
draft** — not stale-since-written, but wrong AT THE TIME OF WRITING, each caught only by
someone actually re-running code or re-grepping rather than trusting the prose:

- **Spike 4's original `createScanner` code didn't even run** — wrong function signature
  and a nonexistent enum member (`SyntaxKind.EndOfFileToken`, should be `EndOfFile`) meant
  it would have hung forever, not "confirmed viable, ran to completion" as first claimed.
  See `spikes.md`'s own corrected spike 4 section for the full story — kept in the document
  deliberately, not silently fixed and forgotten, since the failure-then-correction is
  itself useful evidence about how easy this API is to get subtly wrong.
- **`implementation-details.md` claimed `CheckRefs.ts` "isn't a `CheckPlugin`"** — false
  even at authoring time; it already was, in an ancestor commit that predates this design
  branch. A `grep -n refsPlugin src/cli.ts src/program/links/CheckRefs.ts` would have caught
  it in seconds; nobody ran it before writing the claim down.
- **`problem-space.md` attributed an invented quotation to `AGENTS.md`** ("An earlier
  version used an unguarded cast...") that does not appear anywhere in that file — a
  plausible-sounding paraphrase written WITH quotation marks, which reads as a verbatim
  citation to anyone who doesn't check.

**The lesson, generalized:** verifying line-number citations (the original scope of this
section) is necessary but not sufficient. Before trusting or extending ANY claim in this
package:

1. Re-run spike 4's `createScanner` probe against the CURRENT `typescript` version in
   `package.json` — `unstable/*` surfaces can change without a semver-major bump on the
   classic API (spike 5's own risk note). Use the CORRECTED signature from `spikes.md`
   (`createScanner(true, 0)`, `SyntaxKind.EndOfFile` not `EndOfFileToken`), and actually run
   it to completion, not just read it.
2. Grep the ACTUAL current `CheckRefs.ts`/`RefStore.ts` before trusting this doc's
   line-number citations (`CheckRefs.ts:83`, `RefStore.ts:39`) — they were verified accurate
   as of this design's final revision, but this repo's own `AGENTS.md` is explicit: "a
   changeset written when a PR was opened can go stale by the time it merges," and the same
   applies to any design doc citing specific lines.
3. **Re-verify ARCHITECTURAL claims, not just line numbers** — "is X already a
   `CheckPlugin`," "does Y already exist," "is Z already wired in `cli.ts`" are exactly the
   kind of claim that feels safe to assert from memory/pattern-matching and is actually
   cheap to grep-confirm. Treat any claim of the shape "X doesn't do Y yet" or "X isn't a
   Y" as unverified until grepped, regardless of how confident it reads.
4. **Never trust quotation marks around text attributed to another file without opening
   that file and finding the exact string.** A paraphrase in quotes is indistinguishable
   from a verbatim citation to a reader who doesn't check — this package had one real
   instance of exactly that (the fabricated `AGENTS.md` quote above) and a second, milder
   one (a near-miss misquote of `markdownFences.ts`'s actual wording, corrected in
   `solution-space.md`).

## The pattern this design followed, worth reusing for the NEXT issue like this

1. **Ground every option in the real, already-owned dependency graph before proposing a
   new one.** Spike 2/3/4/5 (this repo's `typescript` devDependency, `oxlint`'s bundled
   binary) found a usable primitive that wasn't obvious from the issue text alone, and
   ALSO found that the "obvious" approach (classic `ts.createSourceFile`) doesn't work with
   this repo's own pinned version. Both facts only surfaced by actually running code, not
   by reasoning from general TypeScript-tooling knowledge.
2. **Enumerate options wider than the issue itself proposes**, then rank by the SAME
   constraints (`problem-space.md`'s numbered list), not by novelty or cleverness — option
   C (git-diff heuristic) is a real idea a reasonable engineer would reach for; writing
   down why it's rejected is more useful to a future reader than silently not considering
   it.
3. **Story-map the actual workflow, not the feature surface** — `story-map.md`'s backbone
   is the doc author's real sequence of actions, not "config options we're adding." This
   is what surfaced the rename-resilience requirement as a HARD gate for Release 3, not an
   afterthought: it fell directly out of asking "what does a contributor experience when
   they rename a cited symbol," a question the solution-space comparison alone wouldn't
   have forced.
4. **Sequence releases by cost/value, not by "logical" build order.** Release 1 (config
   scoping) ships before Release 2 (parsing) not because config always comes first as a
   matter of process, but because THIS specific config slice alone already fixes the
   reporter's real repro at zero parsing cost — verified against `roadmap.md`'s own
   walking-skeleton reasoning, not assumed.

## Where this connects to the rest of the codebase (for `checks.docCoverage` accuracy)

This design's own source files (once Release 1+ ship as real code) will need to be cited
from `docs/architecture.md` themselves, the same way `CheckDocCoverage.ts`/`DocCoverage.ts`
are today (`.cairnrc.json`'s own `checks.docCoverage` config, dogfooded in PR #122) — do not
let this be the next "bare-backtick mention instead of a real link" gap `spikes.md`/
`problem-space.md` are themselves about.
