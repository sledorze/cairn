# Knowledge / skill: reaching root-level docs with a generic checker (issue #151)

A distilled how-to for whoever picks up `roadmap.md`'s Release 1, or hits a similarly-shaped
gap later — the reusable technique this design surfaced, not a restatement of the other
docs. Read `problem-space.md` → `solution-space.md` first for WHY; this doc is HOW to keep
extending it correctly, and what NOT to repeat.

## The core lesson: a scanning-exclusion mechanism and an existence universe are two different concerns, even when they share one config key

`ignore` answers "what should I skip while SCANNING for sources/citations." `known` (inside
`CheckLinks.ts`) answers "what counts as EXISTING, for the purpose of resolving a link
target." This design's own spike ([`spikes.md`](./spikes.md)'s Spike 2) found these two questions
conflated in exactly one place — `DocsFs.listFiles`'s directory pruning feeds both — and
that conflation is harmless for `ignore`'s ORIGINAL use case (`node_modules`: nobody wants
either question answered "yes" for it) but actively wrong the moment you repurpose the same
mechanism for a question it was never designed to answer (a real, present, linked-to
directory you only wanted to exclude from the SCAN side, not the EXISTENCE side).
**Generalized:** before reusing an existing exclusion/scoping mechanism for a new purpose,
ask explicitly "does this mechanism's existing SIDE EFFECT (not just its stated purpose)
also apply to the new question I'm asking, or only look like it does." This design's own
`docs/design/CONVENTION.md` and `docs/design/101-refs-symbol-scoping/problem-space.md` both
independently make a version of this same point for `ignore` vs. `--refs` (a different pair
of concerns, same shape of mistake to avoid) — worth recognizing as the SAME lesson
recurring in a third place, not three unrelated observations.

## How this design validated the shortcut before trusting it

**Neither of this design's two most load-bearing claims was accepted on a code read
alone.** Both were run for real, against the actual built CLI, before being written down as
settled:

1. Spike 1's claim ("`isDir` really drops a file-shaped root") could have been asserted
   directly from reading `config.ts:220` — a plausible, arguably sufficient level of
   confidence for a three-line function. It was run anyway (`node dist/cli.js check --root
AGENTS.md --links-only`), because a static read can miss an upstream default/override
   that changes the actual observed behavior (e.g. a CLI flag silently falling back to
   `docs` when the override resolves empty — it doesn't here, but that's exactly the kind
   of thing only running the real binary would catch).
2. Spike 2's claim (option 2, the `ignore: ["*/"]` shallow scan, is broken) is the one
   that actually mattered most: it looked plausible enough on paper that a design written
   without running it might have recommended it. Running it against this repo's own real
   `AGENTS.md` links — not a synthetic fixture — is what turned "this probably has the
   pruning/existence conflation problem" into "here are the four specific real links it
   wrongly flags, and here's the exact CLI invocation that reproduces it." The gap between
   those two confidence levels is the entire value of a spike section; this repo's own
   `AGENTS.md` names it directly: "verify an architectural shortcut by construction (run
   the actual CLI against a real config) before trusting a static code read."

**The lesson, generalized:** a plausible-sounding zero-code workaround is exactly the kind
of claim most likely to get accepted without verification, because it's the CHEAPEST
option and confirmation bias favors not looking too hard at the cheap option. Run it
before ranking it, not after.

## The pattern this design followed, worth reusing for the next issue like this

1. **Run a cheap recurrence gate BEFORE any design work**, per this repo's own `AGENTS.md`
   rule — `docs/incidents/recurrence-gate/three-bespoke-root-doc-checks.md` was written
   and checked (two confirmed independent instances, one proposed-but-unmerged third) as
   its own, separate, prior step, not invented fresh inside this package's
   `problem-space.md`. This design package CITES that finding rather than re-deriving it,
   which is itself the correct discipline: a recurrence-gate finding is meant to be
   reusable evidence, not a one-off note buried in whichever design happens to read it
   first.
2. **State the evidence basis's real size honestly, including what does NOT generalize.**
   `problem-space.md` explicitly says "maintainer-self-reported, not externally
   corroborated" and separately, explicitly, declines to count PR #148 as a third
   independent instance — matching `docs/design/101-refs-symbol-scoping/problem-space.md`'s
   own discipline of not overstating a single-reporter issue as broad demand. An earlier
   draft of the source material for this package DID conflate PR #148 with the two merged
   tests under "three bespoke checks" before its own adversarial review caught and
   corrected it (see the recurrence-gate finding's own commit message) — worth citing as a
   concrete instance of exactly the mistake this rule exists to prevent, not a hypothetical
   one.
3. **When a design's recommended fix touches a primitive shared by many consumers
   (`roots` here; `RefRecord`/`StaleRef` in `docs/design/101-refs-symbol-scoping/`),
   explicitly decide — and record the reasoning for — what does NOT change, not just what
   does.** `roadmap.md`'s "explicit scoping decision" section is the direct analogue of
   that design's Release 2 "packaging must follow the `effect`/`github-slugger`
   precedent" section: both are about not letting a primitive-level fix silently drag in
   obligations nobody asked for, just because the new capability happens to sit next to
   existing ones in the same code path.
4. **Trace a "how big is this change really" claim against the actual current source
   before writing a roadmap around it**, the same discipline
   `docs/design/101-refs-symbol-scoping/spikes.md` applied to `typescript/unstable/ast`'s
   real API shape (finding the classic API gone from the default entrypoint, a genuine
   surprise a design written from memory would have gotten wrong). This design's own
   Spike 3 found the opposite kind of surprise — the change is smaller than a first guess
   might assume, not bigger — which is just as worth confirming for real as the reverse:
   an unverified "this touches two files" claim could easily have undersold real
   complexity hiding in `walk`'s recursive structure; tracing it end to end is what turned
   that into a specific, cited, three-line diff shape.

## Where this connects to the rest of the codebase (for `checks.docCoverage` accuracy)

Once Release 1 ships as real code, `src/config.ts`'s widened `expandOne` and
`src/io/DocsFs.ts`'s widened `listFiles` become citable implementation for this design
package itself — this package's own `_SUMMARY.md` and `implementation-details.md` should
gain real `[text](../../../src/config.ts)`-style links once that code exists, the same
discipline `docs/design/101-refs-symbol-scoping/knowledge.md`'s own closing section
names for its design. Don't let this become the next "bare-backtick mention instead of a
real link" gap `--prose-refs` exists to catch.
