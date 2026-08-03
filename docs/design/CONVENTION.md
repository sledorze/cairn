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
- `problem-space.md` — the failure/gap, root cause, constraints on any fix.
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

## The config that enforces it — SCOPED per package, not a shared wildcard

**An earlier version of this section recommended shared, wildcard kind globs** (e.g.
`"glob": "**/docs/design/*/spikes.md"`, matching ANY package). Stress-tested and found
capturable — see "Is any of this actually capturable?" below for the full finding. The
corrected, actually-recommended shape scopes every kind id and glob to ONE exact package
path (replace `<slug>` with your own directory name, e.g. `101-refs-symbol-scoping`):

```json
"checks": {
  "coverage": {
    "kinds": [
      { "id": "<slug>-design-package", "select": { "by": "path", "glob": "**/docs/design/<slug>/_SUMMARY.md" } },
      { "id": "<slug>-problem-space", "select": { "by": "path", "glob": "**/docs/design/<slug>/problem-space.md" } },
      { "id": "<slug>-solution-space", "select": { "by": "path", "glob": "**/docs/design/<slug>/solution-space.md" } },
      { "id": "<slug>-spikes", "select": { "by": "path", "glob": "**/docs/design/<slug>/spikes.md" } },
      { "id": "<slug>-story-map", "select": { "by": "path", "glob": "**/docs/design/<slug>/story-map.md" } },
      { "id": "<slug>-roadmap", "select": { "by": "path", "glob": "**/docs/design/<slug>/roadmap.md" } },
      { "id": "<slug>-implementation-details", "select": { "by": "path", "glob": "**/docs/design/<slug>/implementation-details.md" } },
      { "id": "<slug>-knowledge", "select": { "by": "path", "glob": "**/docs/design/<slug>/knowledge.md" } }
    ],
    "rules": [
      { "from": "<slug>-design-package", "to": "<slug>-problem-space" },
      { "from": "<slug>-design-package", "to": "<slug>-solution-space" },
      { "from": "<slug>-design-package", "to": "<slug>-spikes" },
      { "from": "<slug>-design-package", "to": "<slug>-story-map" },
      { "from": "<slug>-design-package", "to": "<slug>-roadmap" },
      { "from": "<slug>-design-package", "to": "<slug>-implementation-details" },
      { "from": "<slug>-design-package", "to": "<slug>-knowledge" }
    ]
  }
}
```

**Still kind-based, not filename-based** within one package: a rule is satisfied by ANY doc
matching the `to` kind's glob, so an author is free to name their OWN files however they
like (this repo's own `problem-space.md`/`solution-space.md`/... naming is one convention,
not a requirement `checks.coverage` itself imposes). What changed is scope, not naming
freedom: the glob no longer reaches across package boundaries. This costs real reusability
— a new package can't just reuse a shared block, it needs its own scoped one (see "Is any
of this actually capturable?" for why, and the onboarding-guard script that keeps this
manageable as more packages appear).

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

## Is any of this actually capturable? — a real, severe finding

Stress-tested directly: created a throwaway second package
(`docs/design/999-fake-test-package/`) containing NOTHING but a `_SUMMARY.md` that
cross-linked every one of the real package's docs — zero real content of its own. Against
the ORIGINAL config (shared, wildcard kind ids — `spikes` matching
`**/docs/design/*/spikes.md`, any package), this fake package passed `checks.coverage`
**cleanly, with zero warnings.** `capturable` was not a theoretical worry; it was real and
severe — an author (or a tool generating filler to satisfy a gate) could get a fully green
check without writing a single real word.

**Fixed by scoping every kind id and glob to the exact real package path** (`101-` prefix,
exact filenames, no `*` wildcard — see the config above). Re-ran the identical stress test
against the corrected config: the fake package's `_SUMMARY.md` no longer matches ANY kind
at all (its path isn't `docs/design/101-refs-symbol-scoping/_SUMMARY.md`), so cross-package
satisfaction is now structurally impossible for this package's rules.

**This fix has its own honest cost, found the same way — stress-tested, not assumed.**
Created a THIRD throwaway package: genuinely new, genuinely incomplete (only a
`problem-space.md`, missing all 6 other required pieces), never added to `.cairnrc.json`.
Result: **zero warnings, completely invisible to `checks.coverage`.** The scoped fix closes
the adversarial gap but reopens the ORIGINAL gap this whole convention exists to catch —
honest, accidental incompleteness — for any package nobody remembers to onboard. Scoped
kinds require a human to explicitly wire up `.cairnrc.json` for every new package; nothing
currently makes that step visible or mandatory the way `pnpm changeset` is gated on every
user-facing PR (see this repo's own `scripts/check-changeset.sh`).

**Closed for the buildable-now option; the deeper one stays future work.** Two candidate
directions were identified:

1. A genuinely new `checks.coverage` selector relation — "matches a doc of this kind IN THE
   SAME PARENT DIRECTORY as the FROM doc" — would make wildcard kinds safe again without
   per-package hand-scoping. A real core-engine change (`core/structure/Coverage.ts`'s
   `resolveRuleEdges`, `core/Config.ts`'s `KindSelectorInputSchema`), not a config tweak —
   deserves its own problem-space/solution-space treatment, deliberately NOT built here.
2. **Built:** `scripts/check-design-package-onboarding.ts` — a repo-level guard (mirroring
   `scripts/check-changeset.sh`'s own "gate every PR" precedent, reusing `core/glob.ts`'s
   own matcher so it stays consistent with how `checks.coverage` itself matches) that scans
   `docs/design/*/` for real packages and fails loudly if any has no matching
   `checks.coverage` kind. Wired into `lefthook.yml`'s pre-push AND `.github/workflows/ci.yml`
   — same shared-script-not-two-copies shape the changeset gate already established. Verified
   by the same falsification discipline as everything else here: a real unconfigured package
   makes it fail with an actionable message; removing that package makes it pass again.

Adding a design package's `.cairnrc.json` block is still, additionally, a REQUIRED step in
the SAME PR that creates the package — the guard above is the automated backstop for anyone
who forgets, not a replacement for doing it deliberately.

**Materialized as a real, shipped skill, not just this repo's own docs.** `cairn init
--agent claude` now scaffolds a second skill file
(`.claude/skills/cairn-design-package/SKILL.md`, sourced from `DESIGN_PACKAGE_SKILL_BODY` in
`src/init/content.ts`) teaching this entire discipline — the seven documents, scoped kinds,
the onboarding-guard convention, precise verb naming, and self-stress-testing before trusting
a package — to every future cairn consumer. Dogfooded for real: ran `cairn init --agent
claude` against a scratch directory and confirmed the file writes with the expected content,
plus a real integration test (`src/init/generate.integration.test.ts`) locking it in.

## A vocabulary for rule names — checked against real content, not chosen for sound

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
