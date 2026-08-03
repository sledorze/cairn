# The design-package convention (and how it's structurally enforced)

## Why this exists

A design package (`docs/design/<slug>/`) is deliberately **plain Markdown prose**, not a
generated artifact — the reasoning, evidence, and tradeoffs it records need a human (or an
agent) to actually think and write, not fill in a template mechanically. But prose alone
has no way to guarantee a package is actually COMPLETE: nothing stops an author from
skipping the spikes, or writing a roadmap with no evidence behind it, and nothing would
notice. The fix isn't a new file-generation mechanism — it's making the EXISTING
`checks.coverage` feature (kinds/rules — see the README, `docs/adr/0002-coverage-orphan-check-scoped-to-declared-to-kinds.md`) enforce the
package's required shape, the same way it already enforces any other doc→doc obligation.

**This is dogfooding a real question from this repo's own usage of cairn**: "are these
design-doc files just informal convention, or something cairn's own config can hold to a
required shape?" The answer, materialized here rather than left as an aspiration: **the
existing `kinds`/`rules` mechanism already does this — no new config primitive was needed.**

## The convention

A design package is a directory `docs/design/<slug>/` containing:

- `_SUMMARY.md` — the package's own index, linking every child doc below.
- `problem-space.md` — what we're actually trying to address: the real need, market, or
  context this work responds to, not just its technical symptom. A bug report or failed
  spike is EVIDENCE the problem exists, not the problem itself — "`--refs` fails on every
  unrelated edit" is a symptom; "citing real implementation from docs stops being viable
  once citation and code-change frequency collide" is the actual need underneath it. Also
  carries the root cause, constraints on any fix, and an honest evidence basis (how many
  real reports this rests on — one anecdote, or corroborated context).
- `solution-space.md` — candidate directions, evaluated and ranked; rejects recorded, not
  silently dropped.
- `spikes.md` — feasibility evidence actually RUN, not assumed.
- `story-map.md` — the real user workflow, mapped to stories and a walking-skeleton slice.
- `roadmap.md` — shippable increments, with migration notes.
- `implementation-details.md` — concrete enough to start from.
- `knowledge.md` — the reusable technique, for whoever extends this later.

Any consumer of `cairn` can adopt this exact shape for their own design work by copying the
`checks.coverage` block below into their own `.cairnrc.json` — nothing here is specific to
cairn's own repo beyond the `docs/design/` path, which is itself just a convention, not a
hardcoded assumption.

## The config that enforces it — ONE generic block, safe by construction

**This section has been rewritten twice already, each time after a real, run — not
assumed — finding.** First it recommended a shared wildcard glob (capturable — a hollow
package could pass by cross-linking a sibling). Then it recommended per-package hand-scoped
kind ids (closed capturability, but reopened the ORIGINAL "forgot a piece" gap for any new
package nobody remembered to configure, and meant `.cairnrc.json` growing without bound as
packages accumulate — a real, separately-confirmed cost). Both replaced by a real core
feature, `scope: "sibling"` on a `CoverageRule` (`core/Config.ts`/`core/structure/
Coverage.ts`): restricts rule satisfaction to a `to`-kind doc in the SAME parent directory
as the `from` doc. One small, GENERIC, wildcard-based block now works correctly for every
design package at once — present and future, at any nesting depth (`docs/design/<slug>/`,
or `docs/design/<time-bucket>/<slug>/` if you organize by sprint/cycle/quarter later) — with
**zero additional config, ever, per package**:

```json
"checks": {
  "coverage": {
    "kinds": [
      { "id": "design-package", "select": { "by": "path", "glob": "**/docs/design/*/_SUMMARY.md" } },
      { "id": "problem-space", "select": { "by": "path", "glob": "**/docs/design/*/problem-space.md" } },
      { "id": "solution-space", "select": { "by": "path", "glob": "**/docs/design/*/solution-space.md" } },
      { "id": "spikes", "select": { "by": "path", "glob": "**/docs/design/*/spikes.md" } },
      { "id": "story-map", "select": { "by": "path", "glob": "**/docs/design/*/story-map.md" } },
      { "id": "roadmap", "select": { "by": "path", "glob": "**/docs/design/*/roadmap.md" } },
      { "id": "implementation-details", "select": { "by": "path", "glob": "**/docs/design/*/implementation-details.md" } },
      { "id": "knowledge", "select": { "by": "path", "glob": "**/docs/design/*/knowledge.md" } }
    ],
    "rules": [
      { "from": "design-package", "scope": "sibling", "to": "problem-space" },
      { "from": "design-package", "scope": "sibling", "to": "solution-space" },
      { "from": "design-package", "scope": "sibling", "to": "spikes" },
      { "from": "design-package", "scope": "sibling", "to": "story-map" },
      { "from": "design-package", "scope": "sibling", "to": "roadmap" },
      { "from": "design-package", "scope": "sibling", "to": "implementation-details" },
      { "from": "design-package", "scope": "sibling", "to": "knowledge" }
    ]
  }
}
```

The mandatory single `*` (not `**`) between `docs/design/` and the filename matters: an
earlier attempt used `**`, which — being able to match ZERO segments — accidentally matched
`docs/design/_SUMMARY.md` itself (the PARENT index, not a package) as a "design-package". A
real bug, caught only by running this against the actual repo, not by reading the glob and
assuming it was right.

**Still kind-based, not filename-based**: a rule is satisfied by ANY doc matching the `to`
kind's glob IN THE SAME DIRECTORY, so an author is free to name their own files however they
like (this repo's own `problem-space.md`/`solution-space.md`/... naming is one convention,
not a requirement `checks.coverage` itself imposes).

## Materialized and falsified for real, not just designed on paper

Enabled in this repo's own `.cairnrc.json` (dogfooding), then verified against the real
`docs/design/101-refs-symbol-scoping/` package: `cairn check` passes cleanly today (every
required kind present and linked). Falsified by removing the `spikes.md` link from that
package's `_SUMMARY.md` — `cairn check` immediately reported it three independent ways at
once: `checks.coverage`'s own `missing coverage` (`no link to a "spikes"-kind doc`),
`checks.coverage`'s `orphan` detection (`spikes.md` now has zero inbound references), AND
the pre-existing summary link-completeness check (`missing child links`). Restoring the
link returned to green. All three signals converging on the same real gap is a genuinely
strong result — not one narrow check, but the intersection of three already-independently-
useful ones.

## A real, honest limitation — found by adversarial stress-testing, not glossed over

**Superseded by "Is any of this actually capturable?" below — kept here, corrected, rather
than silently deleted, since the ORIGINAL wildcard-kinds design (this section's original
subject) really did have this gap.** `checks.coverage`'s rules aren't scoped per-directory
by default: a rule `{from: design-package, to: spikes}` under a SHARED, wildcard kind is
satisfied by a link to ANY doc of kind `spikes` ANYWHERE in the corpus, not specifically one
package's own `spikes.md`. Verified concretely (see below): a throwaway second package
whose `_SUMMARY.md` linked entirely to a real sibling's docs — none of its own — passed
`checks.coverage` cleanly. The scoped-kinds fix (this doc's actual current recommendation,
"The config that enforces it" above) closes this specific gap by construction, at the cost
described in "Is any of this actually capturable?"'s own onboarding-guard section.

## Linking to the real dev issue (real, done) — and product issues/vision (proposed, not built)

Every doc in this package used to say "issue #101" as plain, unlinked text — real content,
but not a real reference anyone (or any tool) could follow or verify. Fixed by adding one
authoritative `[issue #101](https://github.com/sledorze/cairn/issues/101)` link per doc
(the first substantive mention, not every occurrence — matching the same "one real link is
enough to establish the relationship" discipline the `grounded_by` rules above use).

**Honest limit on how far this generalizes today**: `checks.coverage`'s `kinds` classify
real FILES cairn scans by path glob — it has no concept of an external URL as a kind, so
"every design package must link to a real GitHub issue" can't be a `checks.coverage` rule
the way "must link to a `spikes`-kind doc" is. The link above is real and useful, but
un-enforced; nothing fails `cairn check` if it's missing or wrong. Closing that gap for
real would need a genuinely new capability — e.g. a `CoverageTarget` variant like the
already-existing `{ external: 'path' }` (a rule satisfied by a link to a real file on disk),
extended with something like `{ external: 'url', pattern: '...' }` (a rule satisfied by a
link matching a URL pattern) — not designed here, since it needs its own problem-space/
solution-space treatment the way issue #101 itself got, not a bolt-on paragraph.

**A separate, larger idea raised alongside this — deliberately NOT modeled here**: linking
design packages not just to a dev issue (GitHub, this repo) but to a "product issue" layer
capturing feedback from interviews or real user experience that shapes vision, upstream of
any specific GitHub issue. This repo has **no real content to ground that in** — every issue
here is dev-flavored (dogfooded by the tool's own maintainer), not sourced from a separate
product/customer-feedback process. Modeling it here would mean inventing fictional
interview data to hang a schema on, which breaks this whole convention's own founding
discipline (every claim in this package was run or grepped, never assumed). Worth pursuing
as its own scoped design package — filed as a real GitHub issue first, the same way #101 and
#108 were — once there's real product-issue content (this repo's own, or a consumer's) to
verify the model against, not before.

## Is any of this actually capturable? — a real finding, closed by a real core feature

Stress-tested directly, three times, each round finding something real:

1. **A shared wildcard kind is capturable.** A throwaway second package containing NOTHING
   but a `_SUMMARY.md` that cross-linked every one of the real package's docs — zero real
   content of its own — passed `checks.coverage` **cleanly, with zero warnings**, under a
   plain wildcard kind glob (`spikes` matching `**/docs/design/*/spikes.md`, any package).
   Not theoretical: an author (or a tool generating filler to satisfy a gate) could get a
   fully green check without writing a single real word.
2. **Scoping per-package by hand closes that, but reopens the original gap.** An interim fix
   gave every kind id an exact, package-specific path (`101-spikes`, no wildcard). Re-ran the
   attack — correctly rejected. But a THIRD throwaway package — genuinely new, genuinely
   incomplete, never added to `.cairnrc.json` — got **zero warnings, completely invisible**.
   The scoped fix traded a rare adversarial gap for a common accidental one: any new package
   nobody remembers to hand-configure is silently unchecked, worse than not having the check
   at all for that package. It also meant `.cairnrc.json` growing without bound — one
   hand-copied 8-kind/7-rule block per package, forever.
3. **The real fix: `scope: "sibling"` on a `CoverageRule`.** A genuinely new
   `checks.coverage` capability (`core/Config.ts`, `core/structure/Coverage.ts`) — a rule
   marked `scope: "sibling"` is satisfied only by a `to`-kind doc sharing the `from` doc's
   own parent directory. One generic, wildcard-glob config block (above) now closes BOTH
   findings at once: a hollow cross-linking package fails (no sibling of its own to link to),
   AND a brand-new, never-configured package is checked automatically (the wildcard glob
   already matches it) — verified by re-running both attacks against the final config: both
   correctly caught, with zero manual `.cairnrc.json` changes for either scenario.

This made a repo-level onboarding-guard script (an earlier, interim mitigation for finding
2, scanning `docs/design/*/` and failing if a package had no matching kind) **provably dead
code** — with a wildcard kind, that check can structurally never fail again — so it was
removed rather than left as confusing, pointless cruft (verified before removal: created a
package under a totally unrelated name, confirmed the script still reported "all onboarded,
OK" — it could no longer distinguish onboarded from not).

**Materialized as a real, shipped skill, not just this repo's own docs.** `cairn init
--agent claude` scaffolds a second skill file (`.claude/skills/cairn-design-package/
SKILL.md`, sourced from `DESIGN_PACKAGE_SKILL_BODY` in `src/init/content.ts`) teaching this
entire discipline — the seven documents, sibling-scoped kinds, precise verb naming with real
guidance text, and self-stress-testing before trusting a package — to every future cairn
consumer. Dogfooded for real: ran `cairn init --agent claude` against a scratch directory
and confirmed the file writes with the expected content, locked in with a real integration
test (`src/init/generate.integration.test.ts`).

## A vocabulary for rule names — and words that actually reach the reader

**A real gap, found by refuting whether the vocabulary below actually GUIDES anyone**:
`rule.name` (e.g. `grounded_by`) only ever fed a bare, quoted, disambiguating label into the
report — `no link ("grounded_by") to a "spikes"-kind doc` — its own code comment says so
explicitly: it exists so two rules sharing a kind pair "don't collapse," not to explain
anything. A reader hitting that message with no prior context has no way to know what
`grounded_by` MEANS or how to fix it without separately finding and reading this doc.

**Closed with a real `description` field** (`core/Config.ts`'s `CoverageRule`), rendered
directly under the missing-coverage line when present — real, in-context guidance, not a
label to look up elsewhere. Structurally optional on the field itself, but **mandatory
whenever `name` is set** — enforced by a decode-time cross-field check, refuting the
tempting-but-wrong "make it mandatory for every rule" version first: an UNNAMED rule's
report line (`no link to a "decision"-kind doc`) is already fully self-explanatory, so
forcing a description there would only produce restated filler — the exact
decorative-not-genuine failure this field exists to avoid. A config with a named rule and no
description now fails to load AT ALL (not just a coverage warning), verified for real: a
description was removed from this repo's own `.cairnrc.json`, `cairn check` refused to even
start, restored, green again.

```
❌ 1 doc(s) missing required coverage:
  docs/design/101-refs-symbol-scoping/solution-space.md
    ✗ no link ("grounded_by") to a "spikes"-kind doc (required by kind "solution-space")
      A cost/feasibility/risk claim needs real evidence — cite the spike that backs it.
```

Adding `description` to `CoverageRule` also caught a real, adversarial-review-documented
recurring bug on its own: `checkCoverage`'s rule-dedup key (`program/structure/
CheckCoverage.ts`) has now collapsed two same-pair rules differing only by an undeduped
field FOUR separate times across this feature's history — `scope` (added alongside
`description`) hit the exact same landmine on first write, caught immediately by that key's
own standing warning comment rather than shipping a fifth silent regression. `description`
itself deliberately stays OUT of the key: purely cosmetic report text, never changes what a
rule actually checks.

`checks.coverage`'s `name` field exists precisely so two rules on the same kind pair can mean
different things (`docs/adr/0002-coverage-orphan-check-scoped-to-declared-to-kinds.md`'s own `implements`/`verified_by` precedent). Early drafts
of this package's own rules used `grounded_by` as a catch-all for every "X cites spikes.md"
edge — re-reading the actual content found it was quietly standing in for at least three
different real relationships:

- `solution-space` → `spikes`, `roadmap` → `spikes`, `problem-space` → `spikes`: the source
  doc makes an ARGUMENT, and spike evidence is offered as support — genuinely `grounded_by`
  (Toulmin's own argumentation-theory term for exactly this: a claim's grounds/data).
- `implementation-details` → `spikes`: "Built on spike 4's confirmed-viable primitive" — not
  an argument being supported, an IMPLEMENTATION using the spike's validated approach as its
  foundation — renamed to `builds_on`.
- `knowledge` → `spikes`: "Use the CORRECTED signature from spikes.md" — instructional
  content directly copied/restated from the spike, not argued for — renamed to `sourced_from`.

A larger reference vocabulary, drawn from established fields rather than invented per-edge,
for whoever names the next rule:

**Requirements traceability** (already partly used in `docs/adr/0002-coverage-orphan-check-scoped-to-declared-to-kinds.md`): `implements`,
`verifies`, `verified_by`, `satisfies`, `derives_from`, `refines`, `traces_to`, `depends_on`,
`realizes`, `conforms_to`, `specializes`, `generalizes`.

**Toulmin argumentation theory** (claim / grounds / warrant / backing / qualifier / rebuttal
— the actual academic model `grounded_by` borrows from, not an invented term): `grounds` /
`grounded_by`, `warrants`, `backs` / `backed_by`, `qualifies`, `rebuts` / `rebutted_by`,
`refutes`, `supports`, `contradicts`, `undermines`, `corroborates`.

**Evidence / epistemic relations**: `evidences` / `evidenced_by`, `justifies`,
`substantiates`, `validates`, `confirms`, `disconfirms`, `motivates`, `informs`.

**Lineage / process relations** (for how a doc came to exist, not what it claims):
`derived_from`, `sourced_from`, `distilled_from`, `builds_on`, `supersedes`, `deprecates`,
`amends`, `extends`, `elaborates`, `clarifies`.

Picking from this list is not optional decoration — the same discipline `knowledge.md`
already documents applies here: before naming a rule, re-read the actual sentence making the
claim, and pick the word that's true of THAT sentence, not the word that sounds most
sophisticated. `satisfies` → `derived_from` and `grounded_by` → `builds_on`/`sourced_from`
(both corrected earlier in this same package, by exactly this process) are the proof this
isn't hypothetical.
