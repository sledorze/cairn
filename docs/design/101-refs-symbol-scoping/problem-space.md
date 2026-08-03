# Problem space: `--refs` whole-file granularity (issue #101)

## The mechanism as it exists today

`cairn check --refs` ([`CheckRefs.ts`](../../../src/program/links/CheckRefs.ts),
[`RefStore.ts`](../../../src/core/links/RefStore.ts)) answers a question `checks.links`
can't: not "does this link resolve" but "has what it points to changed since the doc cited
it." `--refs --stamp` hashes the **entire content** of every reference target a doc makes
and records it in a `.cairn/refs/**` sidecar; a later `--refs` run recomputes the hash and
reports a mismatch as `stale`.

`RefRecord` already carries an optional `anchor` field (`RefStore.ts:39`),
populated whenever a link includes a `#fragment` — but `stampRefs`/`checkRefs` never
branch on it. `resolveReferenceContent` (`CheckRefs.ts:83`) reads and hashes the **whole
target file** regardless of whether the link was `../src/engine.ts` or
`../src/engine.ts#checkFile`. The anchor is parsed and stored, but not yet used to narrow
what gets hashed.

**This is a genuinely new axis, not already covered by the existing top-level `ignore`
key** (`core/Config.ts`'s `ignore`, README's own documented default
`["**/node_modules/**"]`) — worth stating explicitly since it's the obvious first
objection. `ignore` scopes which DOC files get scanned as citation SOURCES
(`readMarkdownCorpus`/`listMarkdownFiles`); it says nothing about which CITED TARGETS get
hashed. `CheckRefs.ts`'s own code comment on its `ignore` parameter (`CheckRefsArgs.ignore`)
notes this had to be separately, deliberately wired in — an ignored doc's own citations
not being hashed was a real gap found and closed after the fact, not something `ignore`
did automatically by virtue of existing. `refs.scope` (this design's Release 1, see
`roadmap.md`) is a target-side mechanism with no existing equivalent.

## The failure mode, observed for real (issue #101's own report)

Dogfooding cairn 0.6.0 on `sledorze/falsestart`: `docs/architecture.md` cited 14
implementation files. With `--refs` on, **editing any line of any of them** failed
`cairn check` — including edits that changed nothing the doc actually claimed (a renamed
local variable, a reordered private helper, a comment). The check degenerated into
"this byte range changed," which every doc author already knows from `git diff` — it added
no information `--refs` doesn't already exist to surface selectively.

The observed consequence: **re-stamping became reflexive.** A freshness gate a user clears
without reading is worse than no gate — it manufactures false confidence ("cairn says this
is fresh") while training the author to stop looking. This is the exact failure mode a
freshness check exists to prevent (see this repo's own `AGENTS.md`: "Treat green `check`
as a hard requirement, not a nicety" — a requirement nobody reads before satisfying isn't
one).

## The reporter's workaround, and why it's evidence of a real gap, not a non-issue

The reporter restructured their source tree: each area gained an `index.ts` facade
re-exporting only its public surface, and the doc was rewritten to cite 6 facades instead
of 14 leaves. Measured after the change: appending a line inside `matcher.ts` stays green;
adding an export to `checking/index.ts` correctly fails.

This is a **real fix for that repo** — the restructure was independently justified (a
public/private boundary is good architecture on its own merits) and the reporter says so.
But it is not a fix cairn can rely on:

- **It only works if the target language and codebase already have (or can cheaply grow) a
  facade layer.** Not every language has a lightweight barrel-export idiom; not every
  team wants one purely to satisfy a doc-freshness tool.
- **The causality is backwards.** A documentation tool should describe the codebase's
  actual shape; here it forced a change to that shape. The reporter is explicit: "I would
  not have made it then or for that reason." An architecture decision driven by a doc
  tool's technical limitation, rather than by the codebase's own needs, is the same
  general smell this repo's own `AGENTS.md` warns against elsewhere — e.g. its "Content-
  mutation safety" section's core rule that a mechanism must be scoped by what it's
  structurally meant to touch, not by an incidental side effect of how it happens to work
  today. (No direct quote from `AGENTS.md` is claimed here beyond that section's own
  stated principle — worth being explicit about, since an earlier draft of this document
  mis-cited a fabricated quotation at this exact spot, caught by adversarial review; see
  `knowledge.md`'s "verify quoted text, not just line numbers" lesson.)
- **The escape hatch doesn't generalize.** A repo with no natural facade boundary (a
  script collection, a library with one flat module, a monorepo where the doc genuinely
  needs to cite deep internals for a specific reason) has only two options left: stop
  citing implementation from docs at all (a real loss — `--refs` and `checks.docCoverage`
  both exist BECAUSE citing real code is valuable), or re-stamp on reflex (the failure
  mode above).

## Evidence basis — stated plainly, not overstated

This design rests on **one reported case**: issue #101 itself, filed by cairn's own
maintainer, from their own side project (`sledorze/falsestart`), on a flag (`--refs`) the
README and `--help` both already label experimental/v1. As of this design being written,
the issue has zero comments and zero reactions from anyone else — there is no evidence yet
that another cairn user has hit this, asked for it, or even runs `--refs` at all. That
doesn't make the report wrong (the repro is concrete and the failure mode is real,
verified by reading the actual code), but a 3-release roadmap culminating in a new
dependency on an explicitly-`unstable` API (see `spikes.md`) is a real investment to
justify off a single, self-reported anecdote — worth saying outright rather than implying
broader corroboration exists.

**What DOES generalize beyond the one report, verified rather than assumed:** this repo
has just shipped `checks.docCoverage` (issue #108) and dogfoods it on itself
(`docs/architecture.md` → `src/**/*.ts`, see `.cairnrc.json`) — cairn's own architecture
doc now cites dozens of implementation files directly, by design. `--refs` is deliberately
NOT enabled in this repo's own `.cairnrc.json` today, precisely because turning it on
would hit this exact failure mode here, right now — this is a second, real, independently-
verifiable (not self-reported secondhand) instance of the SAME underlying mechanism
failing, even though it's still the same maintainer/repo family, not an unrelated third
party. That's meaningfully more than pure anecdote, but short of confirmed multi-user
demand — the honest characterization is "two real instances of the same root cause, one
external repo and one internal," not "widespread demand."

## Root cause, precisely stated

The unit of "did the thing this citation is ABOUT change" is not the same as the unit of
"did the file that thing lives in change." Whole-file hashing conflates the two. The
citation `[checkFile](../src/checking/engine.ts)` is (implicitly) a claim about the file as
a whole; `[checkFile](../src/checking/engine.ts#checkFile)` is a claim about one export.
`--refs` today can express the second form syntactically (the anchor parses) but evaluates
it with the first form's semantics (whole-file hash). The gap is between what a citation
CAN say and what `--refs` currently MEASURES.

## Constraints on any solution

1. **Never a false negative that hides a real, relevant drift.** A check nobody trusts is
   worse than a noisy one — trust, once lost to a missed drift, doesn't come back by
   tightening later. (Mirrors `docs/adr/0002-coverage-orphan-check-scoped-to-declared-to-kinds.md`'s own orphan-scoping discipline: precision
   errors on the side of "still catches the real thing," never the side of "quietly stops
   catching it.")
2. **No language-specific parser as a hard dependency for the common case.** Cairn's own
   `core/` stays IO-free and dependency-light by explicit policy
   (`docs/architecture.md`'s own "pure decision logic... small, vetted, IO-free... only
   dependencies allowed" rule) — a TypeScript-specific symbol parser is a much heavier
   dependency than `github-slugger`, cairn's one existing exception, and must not become a
   hard requirement for `--refs` to work AT ALL on a non-TS repo.
3. **Packaging, not just "is it heavy": `typescript` is currently a `devDependency`
   (`package.json`), never shipped to consumers.** Cairn's two real runtime dependencies
   (`effect`, `github-slugger`) are both `peerDependencies` with
   `peerDependenciesMeta.*.optional: true` — deliberately consumer-supplied, never bundled,
   so a user who doesn't touch the programmatic API pays nothing for them. Any release that
   makes `typescript` a real runtime dependency of `exports-only`/symbol-scoped hashing
   (Releases 2/3) must follow that SAME precedent (an optional peer dependency with a
   guarded/dynamic import, `unit: 'exports-only'` simply falling back to `whole-file` with
   a clear warning when `typescript` isn't installed) rather than becoming a new,
   unprecedented hard `dependency` that bloats every install. Not resolved further here —
   flagged as a concrete, checkable requirement for whoever implements Release 2, per
   `implementation-details.md`.
4. **Backwards compatible or an explicit opt-in.** `--refs` already has real users
   (dogfooded, per the issue itself). A migration must not silently change what an
   existing `.cairn/refs/**` sidecar means.
5. **Must not become a second, competing "citation granularity" mechanism alongside
   `checks.docCoverage`'s existing structural link check.** Both features read the same
   `extractReferences` output; a design that adds a THIRD independent link-parsing
   convention increases surface area for the two to drift apart — a risk this design's
   own adversarial review (see `spikes.md`/the ADR) is asked to specifically probe.
