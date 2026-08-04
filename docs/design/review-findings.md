# Validation findings — `checks.coverage` structure/gap-closure rounds, applied for real

Each section below is a real, dated round of applying `docs/design/review-prompts.md`'s two
prompts (structure invitation, adversarial judge) to this repo's own `checks.coverage`
schema or configuration — dogfooded with the real bundled CLI, falsified by construction
(revert the fix, confirm the test/CLI output regresses; restore, confirm it passes again),
and reviewed by an independent, context-free agent per this repo's own "Shipping one
iteration well" adversarial-review discipline. `docs/design/CONVENTION.md`'s "Judging this
convention" section cites specific sections here as its evidence trail; [`docs/adr/0005-design-packages-structurally-enforced-by-existing-coverage.md`](../adr/0005-design-packages-structurally-enforced-by-existing-coverage.md)
records the same rounds as its own dated amendment log.

This file is a growing, append-only historical record — new rounds are appended, existing
ones are never rewritten — split out from `docs/design/review-prompts.md` so that file can
stay a lean, timeless reference (the two reusable prompts themselves, unlikely to need
editing every round) while this one absorbs the part that actually grows every round: the
validation evidence. Same doc-role split this repo already applies to
`docs/design/CONVENTION.md` (neutral current-state reference) versus [`docs/adr/0005-design-packages-structurally-enforced-by-existing-coverage.md`](../adr/0005-design-packages-structurally-enforced-by-existing-coverage.md)
(historical amendment log) — see that ADR's own Amendment history for the precedent.

## 1. Worked example: applying both prompts to `docs/adr/`, a different corpus

Both prompts above were run for real against `docs/adr/` (5 ADRs, each with a real `status`
frontmatter field and a Context/Decision/Consequences shape) — a genuinely different corpus
than `docs/design/`, the one `CONVENTION.md`'s own "Judging this convention" section already
reviewed. This section is the evidence that the two prompts generalize, not just a repeat of
that review on the same material.

### Structure invitation, applied

Grounded in real content: `0001` and `0004` both carry `status: proposed`; `0002`, `0003`,
`0005` carry `status: accepted`. All five share one path glob (`docs/adr/*.md`) — nothing
about their PATH distinguishes an accepted decision from a proposed one, only their
frontmatter does. Separately, `docs/architecture.md` — this repo's own "why it's built this
way" doc — already cites three of the accepted ADRs by number in prose (`"domain
(checks.coverage, docs/adr/0002, docs/adr/0003)"`, `"(docs/adr/0003): CheckPlugin.ts's..."`)
but never as a real Markdown link `[...](...)`, and never cites `0001` or `0004` at all — both
still `proposed`. That's a real, concrete signal for a rule: **an accepted decision that
`docs/architecture.md` doesn't reference is a decision the architecture doc has drifted out
of sync with.**

```json
{
  "checks": {
    "coverage": {
      "kinds": [
        {
          "id": "accepted-adr",
          "description": "An ADR whose status is accepted — an active, binding decision.",
          "select": { "by": "frontmatter", "field": "status", "equals": "accepted" }
        },
        {
          "id": "architecture",
          "description": "The architecture overview doc.",
          "select": { "by": "path", "glob": "**/docs/architecture.md" }
        }
      ],
      "rules": [
        {
          "name": "referenced_by",
          "description": "Every accepted ADR must be linked from architecture.md so its decision is discoverable without spelunking docs/adr/.",
          "from": "architecture",
          "to": "accepted-adr"
        }
      ]
    }
  }
}
```

**Not forced into this fit, named explicitly rather than glossed over**: `0004` cites
`docs/design/101-refs-symbol-scoping/problem-space.md` etc. as real Markdown links, but this
is a `proposed` ADR pointing OUT at supporting design docs, not an obligation any accepted-ADR
rule above captures — left unmodeled rather than inventing a `proposed-adr` rule with no
concrete consequence to justify it. `0005`'s five "Amendment" sections (a decision revised
in place across several review rounds) have no frontmatter or heading convention marking
"this ADR was later amended" as a distinct, checkable fact — nothing in the given material
needs it beyond prose, so no kind/rule was proposed for it either.

### Adversarial judge, applied

**(a) Content adequacy** — holds: `0002`'s own Decision section states a specific, falsified
design rule ("A `missing`/`orphan` finding requires a **direct** reference... Confirmed
correct by construction (an adversarial test), not just asserted"), not filler; `0005`'s
Amendments read as a real, dated history of a design changing under stress-testing, not
restated boilerplate. Every ADR read for this exercise (5/5) carried substantive,
non-generic content specific to its own decision.

**(b) Schema expressiveness** — attempted 3 real requirements this corpus surfaces, against
the schema BEFORE this task's fix:

1. _Classify by `status` frontmatter, not path_ — **schema-fundamental gap** (this is the gap
   closed by this task, see below): `KindSelector` had exactly one variant, `by: "path"`;
   there was no way to write a selector matching `status: accepted` at all.
2. _An accepted ADR must eventually be superseded-or-stay-current, re-checked after N months_
   — **schema-fundamental gap**, not newly discovered here: the same "nothing in the schema
   touches dates/mtimes" gap `CONVENTION.md` already recorded. Re-confirmed present in this
   corpus (no ADR here has a `superseded` status value in practice, so there's no real
   instance to further ground this one in — recorded as re-confirmed, not double-counted as
   new).
3. _`0004`'s and `0005`'s real GitHub-issue links (`https://github.com/sledorze/cairn/issues/101`)
   should be enforceable, not just asserted in prose_ — **schema-fundamental gap**, also
   already recorded in `CONVENTION.md` (no URL-pattern `CoverageTarget`) — re-confirmed, not
   new, from this corpus's own `0004`/`0005` content.

Of the 3 attempted, 1 was new to this review (frontmatter-based classification) and 2 were
re-confirmations of gaps `CONVENTION.md` already tracked. The new one — chosen as the single
most concretely-scoped, most directly useful gap for a real library user structuring their
own docs — is the one this task closes: `KindSelector` gains a `by: "frontmatter"` variant
(`{ "by": "frontmatter", "field": "status", "equals": "accepted" }`), additive and opt-in, see
`src/core/structure/DocMetadata.ts` and `src/core/Config.ts`. Dogfooded for real against a
throwaway fixture mirroring this repo's own ADRs: the rule above reports `0001-x.md` (status
`accepted`) missing coverage when `architecture.md` doesn't link it, and reports clean the
moment a real Markdown link is added — confirmed both directions with the actual CLI, not
just unit tests.

**Verdict**: this corpus validates, rather than refutes, "library users can build good
structure from these prompts" — a completely different domain (decision records, not design
packages) produced a grounded kind/rule proposal on the first pass, and the adversarial pass
found one genuinely new, concretely-scoped schema gap (not a restatement of the design-package
review) that was small enough to close in this same task. It does not fully validate: 2 of the
3 schema-expressiveness gaps found here were the SAME gaps `CONVENTION.md` already knew about,
which is itself useful evidence — a gap general enough to recur across two unrelated domains is
more likely a fundamental one than a domain-specific artifact.

## 2. `scope: { under: '...' }` — closing the sibling/corpus-wide granularity gap, and a

negative-result validation against `README.md`/`docs/architecture.md`

`CONVENTION.md`'s Claim 2 named a specific hole: `CoverageRule.scope` had exactly one real
value (`'sibling'`, exact same directory) plus the unscoped default (anywhere in the corpus) —
nothing in between, e.g. "anywhere under this named sub-tree." Closed additively:
`scope: { under: 'some/project/relative/dir' }` (`src/core/Config.ts`'s new
`CoverageRuleScopeInputSchema`, `src/core/structure/Coverage.ts`'s `scopeSatisfied`) — satisfied
only by a `to`-kind doc whose resolved path is nested anywhere below `under`, matched as a
`**/<under>/**` glob (root-independent, the same convention every kind's own `by: 'path'` glob
already relies on) rather than a plain string-prefix compare. `'sibling'` keeps decoding and
behaving identically — purely additive.

### Structure invitation, applied to a genuinely new corpus (`README.md` + `docs/architecture.md`)

Testing generalization rather than re-polishing `docs/design/`'s own review: applied the
structure-invitation prompt to this repo's own top-level `README.md` (563 lines) and
`docs/architecture.md` (293 lines) — the only two top-level docs, verified by listing
`docs/*.md` for real (`docs/_SUMMARY.md` and `docs/architecture.summary.md` are generated
artifacts, not authored source, so excluded as "given documents").

**Draft**: kinds `readme` (`README.md`) and `architecture-doc` (`docs/architecture.md`); one
rule, `readme` → `architecture-doc`, on the reasoning that a reader landing on `README.md`
should be pointed at "why it's built this way."

**Self-critique**: grepped for real, rather than assumed — `README.md` contains ZERO real
Markdown links to any other repo doc (confirmed: `grep -n "\[.*\](.*\.md" README.md` matches
only an illustrative example string inside prose, `[intro](./guide.md#getting-started)`, not a
real link), and never even mentions "architecture" outside an unrelated JSON code sample line.
`docs/architecture.md` itself only cites ADRs `0002`/`0003` as bare prose text, never a real
link — the exact same finding this file's own section 1 already recorded for this
corpus's sibling `docs/adr/`. Two further, corpus-specific problems: (1) this repo's own
`roots: ["docs"]` (`.cairnrc.json`) doesn't even scan `README.md` — it lives at the repo root,
outside every configured root, so neither `checks.coverage` NOR the already-shipped, cheaper
`--prose-refs` would ever see it without a `roots` change out of this task's scope; (2) the
corpus has no MULTIPLICITY — exactly one README, one architecture doc, not many instances of a
repeating shape. `checks.coverage`'s wildcard-glob kinds/rules earns its complexity precisely
when one generic block must cover many present-and-future instances at once (every design
package, every ADR) — see `CONVENTION.md`'s own `scope: 'sibling'` rationale. A rule enforcing
one single static fact ("this one file must link that one file") is exactly the case a human
noticing and hand-adding one link already solves at lower cost than a kinds/rules block, and a
gamed/hollow version of the rule (a bare "see docs/architecture.md" dropped anywhere) would add
no real content-adequacy guarantee either — the same Claim 1 hollow-link risk `CONVENTION.md`
already names for design packages.

**Revise**: no `checks.coverage` structure proposed for this corpus — a genuine negative
result, not forced. The real, evidenced gap this corpus surfaces (`README.md`'s prose
citation of `docs/design/CONVENTION.md`, itself a bare backtick with no `[text](path)` syntax)
is shaped for `--prose-refs`, already shipped — not a new kinds/rules block — and even that
would need `roots` widened to cover `README.md` first, a separate, out-of-scope change not
made here (per this task's own instruction not to wire in anything without genuine judgment
that it's a real, low-risk improvement — widening `roots` to the whole repo root has broader
consequences, e.g. `README.md` itself crossing the 30-line summary threshold, not evaluated
here).

### Adversarial self-judgment of the `{ under: '...' }` capability itself

**Does it close the gap cleanly?** Yes, for the stated granularity problem: dogfooded for
real against a throwaway fixture (a `team-a/pkg1/roadmap.md` doc scoped to
`under: "docs/design/team-b"`, linking a `spikes.md` under `team-a` instead) — the real bundled
CLI (`dist/cli.js`) reports exactly the expected single `missing coverage` line for the
`team-a` roadmap and stays silent for `team-b`'s own roadmap (which correctly links a
`team-b`-nested spike two directories down, proving "nested anywhere below," not just
"directly in"). Falsified the dedup-key interaction too: `program/structure/CheckCoverage.ts`'s
rule-dedup key previously coerced `r.scope` with `${r.scope ?? ''}`, which stringifies ANY
object `scope` to the literal text `"[object Object]"` regardless of its actual `under` value —
two rules differing only by `under` would have silently collapsed into one, the exact
Round 2/3/4 bug class `CheckCoverage.ts`'s own comment already tracks. Reverted the
`JSON.stringify` fix, confirmed the new dedup test fails (`result.missing` length 1, not 2),
restored it, confirmed it passes — a real "Round 5" entry, not a hypothetical.

**Does it introduce a new problem?** Yes, one genuine, un-closed loose end, found by asking
the task's own question directly: `under` is a raw string with ZERO validation against the
config's real `roots`. `CoverageInputSchema`'s existing cross-field check already prevents a
`from`/`to` kind-id typo from silently making a rule permanently unsatisfiable (decode-time
failure, loud) — `under` has no equivalent. A typo'd `under` (e.g. `"docs/desing/team-b"`) or
one naming a directory that falls outside every configured `root` decodes successfully and
then silently, permanently reports every `from`-kind doc as missing coverage, with nothing in
the error pointing at the actual cause — precisely the failure class ADR `0002`'s
Consequences section already named as the reason the kind-id check exists at all, now
re-opened for `under` specifically. Not fixed in this task: `CoverageInputSchema`'s cross-field
check only ever sees `coverage.kinds`/`coverage.rules`, not the sibling top-level `roots` field
— closing this for real needs either passing `roots` into that check (a `CairnConfigSchema`-
level cross-field check, not a `CoverageInputSchema`-level one, a different point in the schema
tree) or a runtime warning once real docs are scanned (mirroring `unmatchedKinds`'s own
non-fatal-hint precedent for a kind glob that matches nothing) — recorded here as a real,
named follow-up rather than silently left implicit.

**Did an independent, context-free reviewer find anything this self-judgment missed?** Yes —
run for real, not hypothetically: a fresh agent with no prior context on this task, handed only
the diff and told to try to break it, found a genuine blocking bug the self-judgment above had
not: `scope: { under: '/' }` (or `''`/`'///'` — anything that trims to empty) collapses
`scopeSatisfied`'s `**/${under}/**` glob into one that matches EVERY path in the corpus. Proved
concretely, not just reasoned: with `under: '/'` configured, `resolveRuleEdges` reported a
`roadmap` doc under `design/team-a/pkg/` as satisfied by a totally unrelated `spikes` doc under
`unrelated/far-away/`. This is a strictly worse failure mode than the already-disclosed
"typo'd/out-of-`roots` `under`" gap above: that one fails LOUD (permanent missing-coverage,
visibly wrong); an empty `under` fails SILENT (vacuously "satisfied," a report line that looks
correctly scoped but isn't scoping anything at all) — exactly the "silently checks the wrong
thing" failure class this whole tool exists to prevent, now nearly shipped by the tool's own
new feature. Fixed before merge, not left as a third disclosed limitation: `under` (`core/
Config.ts`) now rejects, at decode time, any value that trims to empty, with a report naming
the reason. Falsified for real: the same real bundled CLI that previously accepted
`scope: { under: '/' }` and silently cross-satisfied an unrelated doc now refuses to even load
that config (`` `under` must not be empty, or only slashes... `` at
`["checks"]["coverage"]["rules"][0]["scope"]["under"]`).

**Verdict**: `{ under: '...' }` closes the STATED granularity gap correctly, verified by
construction (real CLI dogfood, both directions of a real falsification on the dedup fix) —
and, after an independent adversarial pass this task's own self-judgment missed, no longer
admits the empty/slash-only vacuous-match case either. It does not, and was never asked to,
close the separate, adjacent "validate against `roots`" gap; recorded as open rather than
glossed over, matching this repo's own standing rule for self-reported gaps (`CONVENTION.md`'s
"Self-reported-gap closure tracking"). The empty-`under` bug's own discovery is itself evidence
for why that standing rule (get an independent, context-free read rather than trusting your own
re-read) exists: the author's own first-pass self-judgment, run immediately after writing the
capability, missed a bug a fresh reviewer with no investment in the design found on a first
pass.

## 3. Closing the `under`-vs-`roots` validation gap, and `to` alternation (N-of-M/OR) — a second

round validated the SAME way

Two of Claim 2's remaining named gaps in one task: (a) `under` had zero validation against the
config's own `roots` (recorded open at the end of section 2 above); (b) `CoverageRequirement.by`
had no N-of-M/alternation construct at all — two rules on the same `from` were always AND'd,
never OR'd.

**(a) `under`-vs-`roots`, closed at RUN time, not decode time.** Investigated first, per this
task's own instruction: `roots` and `checks.coverage` are SIBLING top-level fields in
`CairnConfigSchema`, and `../config.ts`'s `resolveLayer`/`layerConfig` can set them in DIFFERENT
`extends` layers — a single-layer schema decode never sees both at once, so a `CoverageInputSchema`-
or even `CairnConfigSchema`-level cross-field check (the shape `from`/`to` kind-id validation
already uses) cannot see the real, fully-merged `roots` the way it sees `kinds`. Fixed instead in
`checkCoverage` (`../../program/structure/CheckCoverage.ts`), once every layer is folded and the
real doc corpus is actually scanned: for every distinct `under` value any rule uses, check whether
ANY scanned doc (of ANY kind, not just the rule's own `to` kind — the narrower, more useful
structural question "does this directory exist in the corpus at all") matches
`**/<trimmed-under>/**`. Zero matches → `CoverageResult.emptyScopeUnders`, a new non-fatal warning
line (never `coverageExitCode`), mirroring `unmatchedKinds`'s own precedent exactly (a kind
matching 0 docs is also just a hint, since mid-rollout is a legitimate zero-docs state).
Dogfooded for real against a throwaway fixture (`scope: { under: "docs/desing/pkg" }`, a real
typo) with the real bundled CLI (`dist/cli.js`): reports
`⚠️  scope { under: "docs/desing/pkg" } matched 0 scanned docs of any kind — check it for a typo,
that it names a directory under a configured \`root\`, or that no docs simply exist there yet.`alongside the (separately real) missing-coverage finding it explains; fixing the typo to`"docs/design/pkg"`makes the warning disappear on the next run, confirmed both directions.
Falsified via the same revert/restore discipline as every other fix here: reverting`CheckCoverage.ts`'s `emptyScopeUnders`computation makes the new tests fail with`[]`instead of
the expected typo'd value (6 tests,`CheckCoverage.unit.test.ts`), restoring makes them pass again.

**(b) `to` alternation.** Closed additively on `CoverageRule.to` itself, not by growing
`CoverageRequirement.by` a new variant (which would still need a NEW field naming which OTHER rule
it alternates with — a much bigger shape change than this gap needs): `to` may now be a single
`CoverageTarget` (unchanged) OR a non-empty ARRAY of them, satisfied by a link matching ANY ONE
element (`targetsOf`, `src/core/Config.ts`; `matchNode`'s per-target loop, `src/core/structure/
Coverage.ts`). Every existing consumer of `rule.to` (`matchNode`, `collectExternalRefTargets`'s
external-candidate set, `CheckCoverage.ts`'s dedup key, `orphanCandidateKinds`, and the report
formatter) was updated to go through `targetsOf`/the new array branch — confirmed by grepping the
whole repo for every other `.to`/`isKindTarget(`/`isUrlTarget(` call site outside the three touched
files (none found, per the independent review below). Real example:
`{ from: 'roadmap', to: ['spikes', 'evidence'] }` — a `roadmap` doc satisfies coverage by linking
to EITHER a `spikes`-kind doc OR an `evidence`-kind doc, dogfooded with the real bundled CLI:
missing when neither is linked, clean the moment either one is. `schema/cairn.schema.json`
regenerated (`CairnCoverageTargetOrAlternatives`), a changeset added, and the Round-6 dedup-key
fix (`JSON.stringify(r.to)` unconditionally, replacing the old `isKindTarget(r.to) ? r.to :
JSON.stringify(r.to)` ternary that assumed `to` was never an array) is itself covered by a
falsified test, per `CheckCoverage.ts`'s own standing 5-rounds-so-far warning comment.

**Independent, context-free adversarial pass (a fresh agent, no prior context beyond the diff and
a description of both features, told to try to break them — same discipline as section 2's own
second-reviewer step).** Findings, reported verbatim rather than summarized away:

- **Real, but pre-existing, not novel**: `schema/cairn.schema.json`'s new array-`to` branch has no
  `minItems: 1`, so an EDITOR's JSON Schema validation (not `cairn`'s own decoder) would silently
  accept `to: []` even though `decodeConfig` rejects it for real. Checked against the file's own
  history: the identical gap already exists for `scope: { under }`'s non-empty check (`Schema.check`
  filters never propagate into the generated JSON Schema in this codebase's setup) — not a
  regression this task introduced, a pre-existing limitation of how `scripts/generate-schema.ts`
  derives the schema. Not fixed here (would need a broader change to how filter constraints
  propagate into `Schema.toJsonSchemaDocument`, out of this task's scope) — recorded as a known,
  pre-existing gap rather than silently left undocumented, matching this file's own "hedge
  language" discipline. **Update, a later round**: "filters never propagate" turned out to be
  imprecise, not fully accurate — a filter carrying its own `toJsonSchema` annotation callback
  (even a no-op one) DOES propagate its `description`, closing the discoverability half of this
  gap (though not the structural `minItems` half, which remains genuinely unexpressible). See
  `CONVENTION.md`'s own "JSON-Schema cross-field-constraint gap" tracked entry for the precise
  investigation and fix.
- **Real, low-severity, not fixed**: the dedup key's `JSON.stringify(r.to)` is order-sensitive for
  an array `to` — two rules that are semantically the same OR-set but list alternatives in a
  different order (`['spikes', 'evidence']` vs `['evidence', 'spikes']`) don't dedupe, producing a
  cosmetic duplicate report line, never a wrong pass/fail or exit code. Separately, a scalar
  `to: 'foo'` and a single-element array `to: ['foo']` (semantically identical) hash to different
  keys (`"foo"` vs `["foo"]`) for the same reason. Judged not worth fixing: normalizing (sorting)
  the array before stringifying adds real complexity for a self-inflicted, cosmetic-only edge case
  no real config has hit; recorded here rather than silently accepted with no record.
- **Ruled out, explicitly investigated**: `emptyScopeUnders`'s dedup is by raw (untrimmed) `under`
  string, so two rules writing `"docs/design"` and `"/docs/design/"` (the same directory,
  differently formatted) could each independently produce a warning line — cosmetic duplication
  only, same severity class as the dedup-key finding above, not fixed for the same reason.
  `isTargetArray`'s explicit predicate was checked for being redundant boilerplate and ruled NOT
  redundant: `Array.isArray` genuinely fails to narrow a `T | readonly T[]` union in the negative
  branch under this codebase's TS setup (confirmed: removing it and inlining `Array.isArray`
  reproduces the exact `tsc` error this task hit and fixed in `formatCoverageReport`). `matchNode`'s
  "first satisfying target wins" was checked against `resolveRuleEdges`'s own per-NODE (not
  per-target) `satisfiedBy` collection and found to preserve the exact pre-existing
  one-node-to-one-match contract — no cardinality assumption elsewhere in the codebase broken.

**Verdict**: (a) closes the STATED gap — a typo'd or out-of-corpus `under` is no longer silent —
verified by construction (real CLI dogfood both directions, a falsified test). It is knowingly
NOT a decode-time guarantee the way the kind-id cross-field check is (a real, disclosed
architectural difference from that precedent, not an oversight); a doc that legitimately doesn't
exist yet under a correctly-spelled `under` looks identical to a typo, the same accepted ambiguity
`unmatchedKinds` already lives with. (b) closes the STATED alternation gap for the minimal,
additive shape asked for (an array `to`, OR-satisfaction) — it does NOT implement general N-of-M
cardinality (e.g. "at least 2 of these 3 alternatives must be linked"), which the gap's original
name ("N-of-M/alternation") could be read as promising; recorded here explicitly as the
narrower-than-the-name reading actually shipped, matching `CONVENTION.md`'s own "Self-reported-gap
closure tracking" discipline — a future "true N-of-M with a minimum count" request is a real,
still-open, narrower gap underneath this one, not silently claimed closed by this task. The
independent adversarial pass found only cosmetic, non-exit-code-affecting edge cases in both, no
crash, no false-negative silently swallowing a real violation, and confirmed the TypeScript
narrowing justification in the new code comments is accurate rather than defensive over-engineering.

## 4. Closing the general N-of-M/`atLeast` gap section 3 left open, plus a systematic vacuity

safeguard and its own adversarial-judge pass (validation findings)

Section 3 closed the OR/"any one" reading of the N-of-M/alternation gap and explicitly recorded
the narrower reading — "at least N of these, N > 1" — as still open. This round closes that
narrower reading, and runs `docs/design/review-prompts.md`'s own adversarial-judge prompt (section 2, with its
steelman-the-opposite second pass) against the result, per this task's own instruction.

**The shape.** `CoverageRule.to` gains a third quantifier alongside the existing single-target
and array/`{ any }` (OR) shapes: `{ atLeast: { n: number, of: CoverageTarget[] } }`, satisfied
when at least `n` of `of`'s targets EACH have their OWN satisfying link — not `n` total links to
the same target. Real example: `{ from: 'roadmap', to: { atLeast: { n: 2, of: ['spikes',
'evidence', 'prior-art'] } } }` requires a roadmap doc to link to at least 2 of the 3 listed
kinds; linking to only `spikes` is NOT enough, linking to `spikes` twice (two different anchors
in the same doc) is also NOT enough — dogfooded for real with the bundled CLI (`dist/cli.js`)
against a throwaway fixture: reports `✗ no link to AT LEAST 2 of: a "spikes"-kind doc, a
"evidence"-kind doc, a "prior-art"-kind doc` when only one of the three is linked, and goes
silent (bar an unrelated pre-existing orphan warning for the un-linked third doc) the moment a
second real link is added — confirmed both directions with the real CLI, not just unit tests.
`{ any: [...] }` was added alongside it as the explicit, named spelling of the array form that
already shipped in section 3 — both spellings decode and behave identically; the bare array is
NOT deprecated, matching this task's own "must stay additive" instruction. "All of these" needed
no fourth `to` variant: it's `n: of.length` over the same `atLeast` shape.

Every existing consumer of `rule.to` was routed through two new centralized helpers rather than
re-deriving cardinality inline: `targetsOf` (already existed, extended to flatten `any`/`atLeast`
too — used where a consumer only needs "every target this rule could possibly match," e.g. the
undeclared-kind check, orphan-candidate collection, external-path candidate collection) and the
new `quantifierOf` (`{ n, targets }` — the ONE place `../structure/Coverage.ts`'s
`resolveRuleEdges` reads a rule's required count from; a single target and the OR shapes are
`n: 1` over their own target list, not a separate code path from `atLeast`). `RuleEdge` gained one
new field, `satisfied: boolean` — `satisfiedBy.length > 0` alone can no longer answer "is this
rule satisfied" once a rule can require a MINIMUM COUNT across several distinct targets rather
than just "did any link match something"; `CheckCoverage.ts`'s `missing` computation was switched
from `satisfiedBy.length === 0` to `!e.satisfied` accordingly, and the dedup key
(`JSON.stringify(r.to)`, already unconditional since section 3's own Round 6 fix) needed no
change — it already structurally discriminates any new `to` shape, including this one.

**Round 7 of the standing dedup-key warning, checked and found NOT triggered.**
`CheckCoverage.ts`'s own comment tracks six rounds of "a new discriminating field wasn't added to
the dedup key" as a recurring bug class, and flags this task as "at least Round 7 if missed." Checked
directly: `atLeast`'s `n`/`of` live entirely INSIDE `r.to`, which the dedup key already hashes via
`JSON.stringify(r.to)` unconditionally — no new top-level `CoverageRule` field was added, so there
was no seventh instance of the bug to introduce. Confirmed by construction, not just by reading the
code: two rules on the same `from` differing only in `atLeast.n` (`{ n: 1, of: [...] }` vs `{ n: 2,
of: [...] }`) produce two DIFFERENT `JSON.stringify(r.to)` keys and are correctly NOT deduped
(covered by the existing "never collapses two same-`from` rules with structurally different object
`to` values" test in `CheckCoverage.unit.test.ts`, which already exercised object-shaped `to`
values before this task and needed no change to also cover `atLeast`).

**Part B: the systematic vacuity safeguard.** `fast-check` (or any property-based testing
library) is confirmed NOT a devDependency (`package.json`'s `devDependencies` has no such entry)
— per this task's own instruction, no new dependency was added for this. Instead:
`src/core/VacuousShapes.unit.test.ts`, one table per vacuity-prone shape (`**` matching zero path
segments — a deliberate, documented NON-fix, since that zero-segment matching is a real, already-
shipped feature elsewhere in this exact codebase, not a defect; empty/slashes-only `scope.under`;
an empty `to` array; and the new `atLeast.n: 0`/negative/empty-`of` cases), each asserting the
real, current safeguard rather than a hypothetical one.

**A genuine finding from running this task's OWN Part D against itself, not a clean pass.**
Writing that table surfaced a REAL bug this task's own first-pass self-review had NOT caught:
`atLeast.of` containing a DUPLICATE target (e.g. `of: ['spikes', 'spikes']`) let ONE real
satisfying link count toward `n` TWICE, since `countSatisfiedTargets` (`../structure/Coverage.ts`)
checks each `of` INDEX independently rather than each distinct target. Proved concretely before
fixing it, not just reasoned about: a direct `resolveRuleEdges` call with `atLeast: { n: 2, of:
['spikes', 'spikes'] }` against a doc carrying exactly ONE link to a `spikes`-kind doc came back
`satisfied: true` — silently requiring FEWER distinct links than `n` implies, precisely the
"expressive matcher silently degrades to always-true" failure class Part B exists to catch,
found INSIDE the very feature meant to close that class, not in some unrelated corner. Fixed
before this task's own commit, not left as a disclosed limitation: `checkAtLeastSane`
(`core/Config.ts`) now rejects, at decode time, any `atLeast.of` containing a structurally
duplicate target (`JSON.stringify`-compared, matching this file's own dedup-key precedent so a
repeated `{ external: 'path' }` object is caught too, not just a repeated string kind id).
Falsified for real: reverting the duplicate check makes the new
`VacuousShapes.unit.test.ts`/`Config.unit.test.ts` tests for it fail (`Result.isFailure` false),
restoring makes them pass again.

**Adversarial-judge pass (schema expressiveness), against the shipped `atLeast` shape.**
Attempted per `docs/design/review-prompts.md`'s own section 2 prompt's discipline — a real requirement, actually written as
config, not asserted as a gap:

1. _"At least 2 of these 3, where one of the 3 is itself an `{ external: 'url', pattern }`
   target"_ — succeeds, no gap: `atLeast.of` accepts any mix of `CoverageTarget` variants, the
   same heterogeneity the array/`{ any }` shape already allowed (this file's own section 3's
   own "mixes a kind alternative with a `{ external: 'url', pattern }` alternative" test, mirrored
   for `atLeast` in `Coverage.unit.test.ts`).
2. _"Require `n` to scale with `of.length` automatically (e.g. 'a majority,' not a fixed number)"_
   — fails, a real schema-fundamental gap: `n` is a literal integer, not an expression or a
   percentage; a config author who wants "at least half" must compute and hardcode that number
   themselves, and update it by hand if `of` ever grows. Newly found by this review, not a
   restatement of an existing `CONVENTION.md` gap — recorded here, not yet added to
   `CONVENTION.md`'s own tracked-gap list, since it has not yet been independently corroborated by
   a second real request the way that list's own discipline expects.
3. _"A DIFFERENT minimum count per `from`-kind doc, not a fixed `n` for every doc of that kind"_ —
   fails as CONFIGURATION-only, not schema-fundamental: `CoverageRule` is declared once per rule,
   not per doc instance, so every `from`-kind doc sharing a rule shares its `n` — but a config
   author CAN already express a per-subset minimum today by writing two separate rules with
   `scope: { under }` partitioning the corpus, each with its own `n`. Not a schema gap; a config
   pattern that already exists.

**Second pass — steelman each finding, per `docs/design/review-prompts.md`'s own section 2's discipline.**

- _Duplicate-target bug, steelmanned as NOT a real bug_: could a duplicate `of` entry ever be
  intentional — e.g. "weight this target twice"? No real semantics for `CoverageRule.to` supports
  a WEIGHTED target anywhere else in this schema (array/`{ any }` treats every alternative
  equally; `scope`/`via` have no per-target weighting concept either) — there is no existing
  vocabulary a duplicate could be "using," so the steelman does not hold; rejecting it outright
  remains correct.
- _`n` scaling with `of.length`, steelmanned as NOT actually a gap_: could this already be
  expressed via `n: of.length` for "all" and a hand-picked literal for anything else, making
  "scale automatically" an ergonomics wish rather than an expressiveness gap? Partially holds —
  the FIXED-`n` cases (all, or a specific hardcoded count) are fully expressible today; only the
  "recompute as `of` grows" case is genuinely unexpressible, since the schema has no relative/
  percentage concept at all. Downgraded from "the schema can't express minimums" (too broad, false)
  to the narrower, accurate claim recorded above (finding 2): only a RELATIVE minimum is the real
  gap, not minimums in general.
- _Per-doc `n`, steelmanned as a real schema gap after all_: is the `scope: { under }` workaround
  in finding 3 actually usable, or too costly to count as "already expressible"? Checked against
  `CONVENTION.md`'s own precedent for a structurally similar workaround (one kinds/rules block
  covering every design package via a wildcard glob, `scope: 'sibling'`) — that pattern was
  praised specifically because it needed ZERO additional config per instance; the `scope: {
under }` workaround for a per-subset `n` needs ONE ADDITIONAL RULE per distinct minimum, which
  does NOT scale the same way. The steelman partially holds: this is a real, if minor, ergonomic
  cost this review's first pass understated by calling it simply "not a schema gap" — still
  correctly classified as configuration-only (nothing is UNEXPRESSIBLE), but the "already
  expressible" framing undersold the real cost, corrected here.

**Verdict.** Part A closes the STATED gap — general N-of-M cardinality, not just OR/alternation —
verified by construction (real CLI dogfood both directions) and confirmed NOT to reintroduce the
standing Round-1-through-6 dedup-key bug (Round 7 checked and found clean). Part B's systematic
safeguard is the smaller, explicit table this task's own instructions called for in the absence of
`fast-check`, and it did its actual job: running it surfaced a REAL, previously-unfound vacuity bug
in this SAME task's own Part A work (the duplicate-`of`-target case), which was fixed and falsified
before commit — the single strongest piece of evidence in this section that Part D's adversarial
posture was applied genuinely, not performed. The schema-expressiveness pass found one real,
newly-surfaced fundamental gap (relative/scaling `n`) not yet promoted into `CONVENTION.md`'s
tracked-gap list, and one configuration-only cost (per-doc `n`) whose steelman pass revealed real,
if minor, ergonomic friction the first-pass framing had understated. Pre-existing, not a
regression: `schema/cairn.schema.json`'s generated JSON Schema still has no way to express
`atLeast.of`'s non-empty/no-duplicate/`n ≤ of.length` cross-field constraints STRUCTURALLY (only
the single-field `n ≥ 1` check propagates, via `minimum: 1`) — the same limitation section 3
already disclosed for the array `to`'s own `minItems`, re-confirmed here for `atLeast`'s three
struct-level checks rather than newly introduced by this task. **Update, a later round**: the
structural half of this gap is genuinely unclosable (JSON Schema draft 2020-12 has no vocabulary
for an arbitrary cross-field predicate like this), but the DISCOVERABILITY half — an editor's
tooltip being able to at least state the rule in prose — is closed: `atLeastSaneFilter` now
carries a `description` via a `toJsonSchema` no-op annotation callback, confirmed to propagate
into `schema/cairn.schema.json`. See `CONVENTION.md`'s "JSON-Schema cross-field-constraint gap"
entry for the full investigation.

## 5. Closing the dates/mtimes gap — `checks.freshness`, its falsestart origin, and real

dogfood/falsification evidence

Section 2 through 4 all closed gaps INSIDE `checks.coverage`'s own `to`/`scope` shapes.
`CONVENTION.md`'s Claim 2 named a gap OUTSIDE that shape entirely: "nothing in the schema
touches dates/mtimes at all, so a 'doc must be re-validated after N months' freshness rule is
outside its vocabulary entirely, not just unconfigured." This section closes it, as its own
separate `checks.freshness` check rather than a `CoverageRule` field — see `CONVENTION.md`'s
own paragraph on why (a genuinely different TEMPORAL axis, not a RELATIONAL one).

**Origin, not invented for this task.** GitHub issue #101 ("`--refs` whole-file granularity
makes documentation drive code structure") is the real incident this closes: "found using
cairn 0.6.0 in `sledorze/falsestart` over one long session," `docs/architecture.md` cited 14
implementation files, and `--refs` failed on every edit to any of them even when the doc's own
claims hadn't changed — "re-stamping became reflexive, which is the failure a freshness check
exists to prevent: a gate you clear without reading." Issue #101's own "Suggested direction"
section named two fixes for `--refs` itself (API-surface hashing, symbol-scoped references —
tracked separately in `docs/design/101-refs-symbol-scoping/`) and, in passing, the freshness
concept this section builds. `checks.freshness` deliberately does NOT touch `--refs`'s own
citation-drift detection — it answers a narrower, orthogonal question ("has anyone looked at
this doc's content in N days, per real git history") that a doc can fail independent of
whether anything it cites moved at all.

**The shape.** `checks.freshness.rules`: an ordered array of `{ glob, maxAgeDays }`. The FIRST
rule (declared order) whose glob matches a doc's path applies; a doc matching none is skipped
entirely — not reported, not counted. `maxAgeDays` is checked against `io/Git.ts`'s
`lastCommitDate` (real git committer date, `git log -1 --format=%cI`) for that exact path, NOT
filesystem mtime — a fresh `git clone`/CI checkout resets every file's mtime to checkout time
regardless of its real history, which would make every doc look brand-new the moment CI runs.
A doc with no commit history yet (a real, uncommitted new doc) is silently excluded from
staleness reporting — there's nothing yet to measure an age from, matching this repo's own
"never silently guess" discipline every sibling check already follows.

**Real dogfood, against this repo's own docs, with the bundled CLI (`dist/cli.js`), not just
unit tests.** A throwaway `checks.freshness` block (`{ "rules": [{ "glob": "docs/**",
"maxAgeDays": 1 }] }`) was added to a scratch copy of this repo's own `.cairnrc.json` and run
for real:

```
❌ 6 doc(s) stale (git history older than their configured maxAgeDays):
  /workspaces/cairn/docs/adr/0001-optional-external-link-liveness-checks.md (7d > 1d)
  /workspaces/cairn/docs/adr/0001-optional-external-link-liveness-checks.summary.md (7d > 1d)
  /workspaces/cairn/docs/adr/0002-coverage-orphan-check-scoped-to-declared-to-kinds.md (2d > 1d)
  /workspaces/cairn/docs/adr/0002-coverage-orphan-check-scoped-to-declared-to-kinds.summary.md (2d > 1d)
  /workspaces/cairn/docs/adr/0003-check-plugin-registry.md (6d > 1d)
  /workspaces/cairn/docs/adr/0003-check-plugin-registry.summary.md (6d > 1d)
```

Confirmed both directions: every reported doc's real age (via `git log -1`) matched the
printed `(Nd > 1d)`, and docs committed within the artificially tight 1-day window (this same
change's own new/edited docs) stayed silent — not flagged. The scratch config was then
reverted (never committed) rather than kept, per the dogfooding decision below.

**Dogfooding decision: NOT enabled in this repo's own `.cairnrc.json`.** Every prior gap
closure in this file (sections 2 through 4) dogfooded its capability INTO this repo's real,
committed config, because the shape being tested (a new `scope`, a new `to` quantifier) had an
immediate, concrete need already present in `docs/design/`'s own coverage rules.
`checks.freshness` does not have that: this repo's docs are actively maintained by the same
people who write the code, and picking a real `maxAgeDays` per glob (`docs/adr/**`?
`docs/design/**`? a blanket `docs/**`?) without a genuine "this doc silently went stale and
nobody noticed" incident here would be exactly the kind of arbitrary, ungrounded threshold this
repo's own `AGENTS.md` guidance ("don't design for hypothetical future requirements") warns
against — picking numbers to exercise the feature, not because this repo has the problem
`checks.freshness` solves. The real incident motivating this check happened in a DIFFERENT
repo (`sledorze/falsestart`); enabling it here would prove the CLI runs, which the dogfood run
above already proved directly, without committing a permanent, unmotivated gate every future
PR here would have to clear. Revisit if this repo itself produces a real "we didn't notice this
doc rotted" incident — the same evidence bar every other noted-but-deferred item in this file
is held to.

**Test coverage, not just the CLI dogfood above.** `src/core/structure/Freshness.unit.test.ts`
(pure `findStaleDocs`: the `maxAgeDays` boundary is strictly `>`, not `>=`; `null` last-commit
dates are excluded; deterministic path-sorted output), `src/program/structure/
CheckFreshness.unit.test.ts` (IO-level `checkFreshness`/`formatFreshnessReport`: first-matching-
rule-wins ordering, a real `GitUnavailableError` treated the same as no-history rather than
crashing, the `noHistory === checked` warning threshold), `src/program/structure/
CheckFreshness.plugin.unit.test.ts` (the `CheckPlugin` wiring: `isEnabled`/`jsonUnsupportedMessage`/
`name`/`format`/no-`stamp`, the named-defect-not-a-crash path when `run` is misused), and
`src/io/Git.integration.test.ts`'s new `GitFsLive().lastCommitDate()` block (the REAL `git`
binary: a committed path's real committer date parses cleanly, an uncommitted path returns
`null`, a non-repository `base` fails with a named `GitUnavailableError` — none of which an
in-memory double alone could prove, matching this file's own existing discipline for every
other `GitFsLive` method).

## 6. Closing the JSON-Schema cross-field-constraint discoverability gap — investigated for

real against `effect`'s own source, partially closed, remainder precisely explained

`CONVENTION.md`'s tracked-gap text previously described this as vaguely "pre-existing, not
newly introduced" without saying WHY. Investigated for real against
`effect@4.0.0-beta.102`'s own source (`internal/schema/toJsonSchemaDocument.ts`'s
`compileCheck`), not assumed: a `Schema.Filter` with no `toJsonSchema` annotation callback is
unconditionally dropped from the generated JSON Schema
(`if (check._tag === "Filter") return undefined`) — confirmed by a standalone
`Schema.toJsonSchemaDocument` probe reproducing the silent drop for real. The same probe found
a real, honest escape hatch: a filter whose `annotations` carries a `toJsonSchema` callback —
even a no-op `() => ({})` — takes `compileCheck`'s OTHER branch, which also merges in the
filter's own `description` via `collectJsonSchemaAnnotations`. Applied via a new `jsonSchemaHint`
helper (`core/Config.ts`) to all four cross-field `Schema.makeFilter` sites (`to` array
non-empty, `atLeast`'s `n`/`of` relationship, `under`'s non-empty-after-trim, and
`CoverageInputSchema`'s own undeclared-kind/description-mandatory check) — each now shows up in
`schema/cairn.schema.json` as an `allOf: [{ description: "..." }]` fragment. This closes the
DISCOVERABILITY half of the gap (an editor's tooltip can now state the rule in prose) but NOT
the STRUCTURAL half: JSON Schema draft 2020-12 has no vocabulary for an arbitrary cross-field
predicate (element-to-element duplicate comparison, one field's value bounded by another
field's length) and `Schema.toJsonSchemaDocument` makes no attempt to special-case a
user-supplied filter into structural keywords — an editor still cannot flag the violation
before `cairn check` runs, only now state what the rule is. `CONVENTION.md`'s own tracked-gap
entry ("JSON-Schema cross-field-constraint gap") now carries this precise explanation in place
of the old vague framing.

**A real pitfall found and fixed while implementing this, not merely disclosed**: the same
probe found `.annotate()` chained directly AFTER `.pipe(Schema.check(...))` on the SAME schema
node overwrites that check's own `description` rather than adding a second, separate one — the
two silently collapse to whichever is applied last. Hit for real in `ScopeUnderPathSchema`
(previously `Schema.String.pipe(Schema.check(underNotEmptyFilter)).annotate({...})`): the outer
`.annotate()` was clobbering `underNotEmptyFilter`'s own new hint text, confirmed by checking
`schema/cairn.schema.json`'s output before the fix (only the outer description appeared, the
filter's own was nowhere). Fixed by reordering to `.annotate()` BEFORE
`.pipe(Schema.check(...))`; falsified by construction — the pre-fix ordering, re-tested in
isolation, reproduces the silent drop; the fixed ordering shows both descriptions, each in
their own place (`CairnCoverageRuleScopeUnder.properties.under`'s top-level `description` and
its own `allOf` entry).

**Independent, context-free adversarial pass** (a fresh agent, no prior context beyond the
diff and a description of the fix, told to try to break it). It independently re-derived and
confirmed the `.annotate()`-ordering bug and fix by writing its OWN standalone
`Schema.toJsonSchemaDocument` probe (not trusting the in-code comment), checked every OTHER
`.pipe(Schema.check(...)).annotate(...)` site in `Config.ts` (`AtLeastNSchema`,
`MaxAgeDaysSchema`, `ThresholdLinesSchema`) for the same latent bug and confirmed none are
affected (the built-in checks they wrap carry no `description` of their own, so nothing is
lost when the outer `.annotate()` merges in), verified all four `jsonSchemaHint` call sites
render correctly and non-redundantly in `schema/cairn.schema.json`'s diff, confirmed no
decode-time behavior changed (`Config.unit.test.ts` + `config.schema.integration.test.ts`,
79 tests, unchanged pass/fail outcomes; `tsc --noEmit` clean), and sanity-checked
`coverage-metrics.ts`'s new `CoverageRule.to` counter (4) against the actual union member
count in source. It found one real but purely cosmetic defect: a doc-comment rename artifact
in `Config.unit.test.ts` and `Coverage.unit.test.ts` (a duplicated `docs/design/` path prefix
left over from the `review-prompts.md`→`review-findings.md` split, mechanically introduced by
a find-and-replace whose replacement text already started with `docs/design/`, colliding with
the original line-wrapped text) — no behavioral impact, fixed before this round's own commit.

**Second pass — steelman each finding, per this file's own section 2 discipline
(`docs/design/review-prompts.md`).**

- _The `.annotate()`-ordering fix, steelmanned as unnecessary_: could the OLD ordering (check
  then annotate) have been left alone, since `cairn check`'s own runtime behavior never
  changed either way — only descriptive text in a generated file? No: the entire POINT of this
  round's work is discoverability via that generated file: an ordering that silently drops the
  new hint text defeats the round's own stated goal for that one field, even though nothing
  breaks at decode time. The steelman does not hold; the fix was necessary to satisfy this
  round's own claim, not merely nice-to-have.
- _The "structural half of the gap is genuinely unclosable" claim, steelmanned as overstated_:
  could a MORE creative `toJsonSchema` callback — not a no-op — actually express something like
  "no duplicate array element" structurally, e.g. via `uniqueItems: true` for `atLeast.of`? On
  inspection this partially holds for exactly ONE of the four sites: `atLeast.of`'s "no
  duplicate target" half IS expressible via the standard JSON Schema `uniqueItems: true`
  keyword — not attempted in this round, a real, narrower, immediately actionable follow-up
  this steelman surfaces rather than the sweeping "genuinely unexpressible" claim as originally
  stated. The OTHER structural pieces (`n <= of.length` as a cross-field bound, the top-level
  undeclared-kind-id check) remain genuinely unexpressible in plain JSON Schema — the steelman
  narrows the claim rather than fully overturning it.

**Verdict.** The discoverability half of the gap is closed, verified by construction (a
standalone `effect` probe proving both the original silent-drop and the fix) and confirmed
safe by an independent adversarial pass that found no decode-behavior change and no other
latent `.annotate()`-ordering bug elsewhere in the file. The steelman pass found one real,
narrower follow-up understated by the first-pass claim (`uniqueItems: true` could close
`atLeast.of`'s duplicate-check structurally, not attempted here) — recorded as a genuine,
smaller open item rather than silently folded into "genuinely unexpressible." One purely
cosmetic doc-comment defect (found by the independent pass) was fixed before commit; no
crash, no false pass, no silently-wrong report was found in either pass.

## 7. Closing the narrower `atLeast.of` `uniqueItems` follow-up section 6 left open, and its own

steelman pass

Section 6's own steelman pass named one real, narrower follow-up it did not attempt: unlike
`n <= of.length` or the undeclared-kind-id check (genuine cross-field predicates JSON Schema
draft 2020-12 has no vocabulary for at all), `atLeast.of`'s "no duplicate target" half maps onto
a real, standard structural keyword — `uniqueItems: true`. This round attempts it for real
rather than assuming it would work.

**Investigated directly against `effect@4.0.0-beta.102`'s own source**, not assumed:
`Schema.isUnique()` (`Schema.d.ts`, `@category Array checks`) exists as a built-in filter
whose own doc comment states "This check corresponds to the `uniqueItems: true` constraint in
JSON Schema" — confirmed by reading its implementation (`Schema.js`): `makeFilter(input =>
Arr.dedupe(input).length === input.length, { toJsonSchema: () => ({ uniqueItems: true }), ...
})`. Proved by a standalone `Schema.toJsonSchemaDocument` probe (`Schema.Array(Schema.String).pipe(Schema.check(Schema.isUnique()))`)
before touching real code: the emitted schema is `{ type: "array", items: { type: "string" },
allOf: [{ uniqueItems: true }] }` — confirming it genuinely flows through, nested under `allOf`
the same way every other `jsonSchemaHint` fragment in this file already does (`to`'s non-empty
check, `under`'s non-empty check).

**Applied to the real field**: `AtLeastTargetInputSchema`'s `of: Schema.Array(CoverageTargetInputSchema)`
(`src/core/Config.ts`) now also carries `.pipe(Schema.check(Schema.isUnique()))`.

**A wrong first-pass assumption, caught by this repo's own coverage ratchet rather than left
uncorrected — recorded here rather than silently fixed and forgotten, since the correction is
itself real evidence for why this repo's "verify by construction" discipline exists.** The first
draft of this change assumed `Schema.isUnique()`'s runtime check uses REFERENCE equality on plain
decoded objects (so it would be strictly weaker than `atLeastSaneFilter`'s existing
`JSON.stringify`-based duplicate check, safe to stack alongside it with no interaction) — reasoned
about, not verified, and wrong. Running the real, existing full test/coverage pipeline
(`pnpm coverage`) surfaced a genuine regression: the global `functions`/`branches` coverage
thresholds (`vitest.config.ts`'s ratchet) failed, pointing at a newly-0%-covered branch inside
`checkAtLeastSane`'s own duplicate-target check. Investigated directly rather than dismissed as
noise: a standalone probe (`decodeConfig({ ... atLeast: { n: 2, of: ['spikes', 'spikes'] } ... })`)
showed the decode failure now comes from `Schema.isUnique()` ("Expected an array with unique
items"), never reaching `checkAtLeastSane`'s own custom message at all — field-level checks run
BEFORE a struct's own cross-field check in this schema library, confirmed directly. Investigating
WHY `Schema.isUnique()` preempts it at all (rather than just accepting the regression) found the
real cause: `effect`'s `Equal.equals` (what `Arr.dedupe`/`Schema.isUnique()` uses) does STRUCTURAL,
key-order-INSENSITIVE comparison for plain objects, not reference equality — confirmed directly
(`Equal.equals({ external: 'url', pattern: 'x' }, { pattern: 'x', external: 'url' })` returns
`true`, while `JSON.stringify` of the same pair differs). This makes `Schema.isUnique()` a STRICT
SUPERSET of what `atLeastSaneFilter`'s `JSON.stringify` compare could ever catch — anything
`JSON.stringify`-equal is necessarily also `Equal.equals`-equal (identical key order is one case of
"any order"), and the reverse is not true (two objects with the same keys in different order are
`Equal.equals`-equal but `JSON.stringify`-different, a real latent gap in the ORIGINAL
`atLeastSaneFilter` duplicate check that this round's addition incidentally also fixes). Combined
with the ordering fact above, `checkAtLeastSane`'s own duplicate-target branch became permanently
unreachable dead code the moment `atLeastOfUniqueFilter` was added — not "kept as harmless defense
in depth" as the first draft claimed, but genuinely dead. Fixed by REMOVING that branch from
`checkAtLeastSane` (and its `Set`/`JSON.stringify` machinery) rather than working around the
coverage gap — the honest resolution once the code was proven unreachable, not a cosmetic
threshold suppression. `vitest.config.ts`'s `functions`/`branches` thresholds were manually
recalibrated down by the resulting tiny amount (98.92→98.91, 92.51→92.5), with a comment recording
why, matching this same config's own pre-existing precedent for a denominator-only shift from
removing genuinely dead code (its `readDirsSafe` recalibration comment).

**Regenerated `schema/cairn.schema.json` for real** (`scripts/generate-schema.ts`), not assumed —
the real diff:

```diff
-            "of": { "type": "array", "items": { "$ref": "#/$defs/CairnCoverageTarget" } }
+            "of": {
+              "type": "array",
+              "allOf": [{ "uniqueItems": true }],
+              "items": { "$ref": "#/$defs/CairnCoverageTarget" }
+            }
```

**Falsified against a real, independent JSON Schema validator (`ajv@8.18.0`, already present in
this repo's own dependency tree), not just re-inspected by eye.** Compiled the real, regenerated
`schema/cairn.schema.json` with `ajv` and validated two configs: a `to: { atLeast: { n: 1, of:
['b', 'b', 'c'] } }` rule (a real duplicate) is rejected, with `ajv`'s own error pointing exactly
at the new keyword — `"schemaPath": "#/properties/atLeast/properties/of/allOf/0/uniqueItems"`,
`"message": "must NOT have duplicate items (items ## 0 and 1 are identical)"`; the same rule with
`of: ['b', 'c']` (no duplicate) validates cleanly. This directly answers the steelman question a
fresh reviewer would ask next (see below): nesting the keyword under `allOf` — the same shape
every other `jsonSchemaHint` fragment in this schema already uses — does not defeat a real,
spec-compliant validator's enforcement of it.

**Verified the real, final accept/reject outcome is unchanged, even though the internal mechanism
is not**: `src/core/Config.unit.test.ts`, `src/core/structure/Coverage.unit.test.ts`, and
`src/core/VacuousShapes.unit.test.ts` (132 tests across the three, after removing
`checkAtLeastSane`'s now-dead branch) pass — every input that was rejected before this round is
still rejected, and every input that was accepted before is still accepted; only WHICH check
produces the rejection message for a duplicate-target input changed (`Schema.isUnique()`'s generic
message, not `checkAtLeastSane`'s own custom one), and neither existing test asserted the specific
message text, so this is a real, disclosed internal-mechanism change with no observable behavior
change for any config this repo's test suite exercises.

**Adversarial steelman pass (per `docs/design/review-prompts.md`'s own discipline), argued against
this closure directly, not just asserted as done:**

- _"Is this genuinely useful, or two mechanisms doing the same job — redundant complexity risking
  drift between them?"_ Once the reference-equality assumption was corrected, this is now the
  MORE serious version of the question: `Schema.isUnique()` doesn't just add discoverability, it
  provably SUBSUMES `checkAtLeastSane`'s original duplicate-target enforcement for every real
  `CoverageTarget` shape (checked above), which is exactly why that branch was removed rather than
  kept as a second, now-redundant enforcement path — keeping both would have been the real
  "two mechanisms doing the same job, risking drift" failure this question warns about.
  `atLeastSaneFilter` still owns the two cross-field checks `Schema.isUnique()` genuinely cannot
  express (`n <= of.length`, non-empty `of`), so nothing was left duplicated after the removal.
- _"Does removing `checkAtLeastSane`'s duplicate branch lose anything real — a case
  `atLeastOfUniqueFilter` can't catch that the old `JSON.stringify` compare could?"_ Checked
  directly, not assumed: since `JSON.stringify`-equal implies `Equal.equals`-equal (identical key
  order is one case of "any order"), every input the old check rejected is still rejected by
  `Schema.isUnique()`. The reverse is also checked and found to be a net IMPROVEMENT, not a loss:
  two `{ external: 'url', pattern }` targets differing only in key order were ACCEPTED (wrongly,
  a real latent gap) by the old `JSON.stringify` compare but are correctly REJECTED by
  `Schema.isUnique()`'s structural comparison — confirmed directly with `Equal.equals`.
- _"Does nesting under `allOf` (rather than a bare top-level `uniqueItems: true` beside `items`)
  actually work, or could it silently be ignored by real tooling — the same shape as the `to`
  array's own non-empty check, which was never verified against a real validator, only inspected
  by eye?"_ This is the one genuine gap in section 6's own verification discipline this round
  closes: previously, every `jsonSchemaHint` fragment's real-world effectiveness was asserted, not
  tested against an actual JSON Schema engine. Verified directly above with `ajv` — the `allOf`
  nesting is fully honored by a real, independent, spec-compliant validator; not merely trusted to
  work because the shape matches existing code.
- _"Is the schema's own top-level `$schema: "http://json-schema.org/draft-07/schema#"` (found
  while setting up the `ajv` probe above — `scripts/generate-schema.ts`'s own output, not
  something this round changed) itself suspicious, given `Schema.toJsonSchemaDocument`'s probe
  output separately reports `dialect: "draft-2020-12"`?"_ A real, PRE-EXISTING inconsistency, not
  introduced by this round and not investigated further here (out of this task's scope — Task 1
  was `uniqueItems` specifically) — recorded here rather than silently noticed and dropped, since
  it's exactly the kind of thing a later round should either explain or fix. Did not block this
  round's own falsification: `ajv`'s default (non-2020) `Ajv` class, matching the file's own
  declared draft-07 `$schema`, compiled and validated it without error either way.

**Verdict.** The narrower follow-up section 6's own steelman pass surfaced is closed for real:
`uniqueItems: true` now appears in `schema/cairn.schema.json` for `atLeast.of`, confirmed to
originate from a genuine `effect` built-in (`Schema.isUnique()`, not a hand-rolled annotation),
and confirmed via a real independent validator (not just re-reading the generated JSON) to
actually reject a duplicate and accept a clean array. Unlike the framing this section's own first
draft assumed, the fix is not purely additive: `checkAtLeastSane`'s original `JSON.stringify`-based
duplicate-target check is REMOVED (not kept alongside), because investigating the coverage
regression the change caused proved it structurally subsumed and permanently unreachable — every
input it used to reject is still rejected by `Schema.isUnique()`, and one real latent gap
(key-order-differing duplicate objects, previously wrongly accepted) is fixed as a side effect.
This whole section is itself a real instance of this repo's own "verify by construction, don't
assume" discipline catching a wrong claim BEFORE it shipped, via the ordinary coverage-ratchet
pipeline rather than a dedicated adversarial pass — recorded in full, including the wrong first
draft, rather than silently corrected and presented as if it were right the first time. The three
OTHER structural pieces section 6's write-up named (`n <= of.length`, the `to` array's non-empty
`minItems`, the top-level undeclared-kind-id check) remain genuinely unexpressible in plain JSON
Schema — narrower than "genuinely unexpressible" as a blanket claim, exactly as section 6's
steelman already concluded, now with one of the four actually closed rather than merely identified
as closeable. A real, pre-existing, unrelated `$schema` dialect-string inconsistency was noticed
while building the `ajv` probe and is recorded above rather than silently dropped, but not fixed —
out of this
round's scope.

## 8. Validating the structure-invitation prompt against two new corpora — `scripts/*.ts` (dev

tooling) and `.changeset/*.md` (a changelog-entry convention) — two more genuine negative results,

each for a different, precisely-evidenced reason

Continuing the generalization-testing pattern (`docs/design/`, `docs/adr/`, `README.md`/
`docs/architecture.md` already tried — the last one a genuine negative result, section 2 above).
This round applies `docs/design/review-prompts.md`'s structure-invitation prompt, its real
3-step draft→self-critique→revise process, to two corpora chosen specifically to be structurally
different from every prior one: `scripts/*.ts` + their `*.unit.test.ts`/`*.integration.test.ts`
siblings (dev tooling, not documentation prose at all), and `.changeset/*.md` (a changelog-entry
convention with real per-file frontmatter, closer in shape to `docs/adr/`'s own status field than
to a design package).

### `scripts/*.ts` and siblings

**The real corpus**, listed directly rather than assumed: `scripts/bench-assert.ts`,
`bench-cli-check.ts`, `bench-cli-startup.ts`, `bench-guard.sh`, `bench-hot-paths.regex`,
`changeset-exempt-paths.regex`, `changeset-required-paths.regex`,
`check-changeset.integration.test.ts`, `check-changeset.sh`, `coverage-metrics.ts`,
`coverage-metrics.unit.test.ts`, `generate-schema.ts` — 12 files, only 2 of which have a real
test sibling at all (`coverage-metrics.ts` ↔ `coverage-metrics.unit.test.ts`, a clean same-stem
pair; `check-changeset.sh` ↔ `check-changeset.integration.test.ts`, a cross-extension pair with
no shared stem-and-extension convention).

**Draft**: kind `dev-script` (`scripts/*.ts`, `scripts/*.sh`, excluding `*.test.ts`), kind
`dev-script-test` (`scripts/*.unit.test.ts`, `scripts/*.integration.test.ts`); rule `dev-script`
→ `dev-script-test`, reasoning that only 2 of the corpus's real executable scripts have a test at
all — a real, visible gap in this corpus's actual current state, the kind of grounding the prompt
requires.

**Self-critique — three separate, escalating blockers, each checked against the real code, not
assumed:**

1. **A hard, mechanical blocker, not a configuration gap.** `src/io/DocsFs.ts`'s
   `listMarkdownFiles` — the ONE shared file-discovery function every check in this codebase goes
   through (`CheckSummaries.ts`, `CheckRefs.ts`, `CheckProseRefs.ts`, `CheckCoverage.ts`,
   `CheckDeletions.ts`, per that function's own doc comment naming all five, extracted precisely
   to stop them drifting apart) — filters unconditionally on `f.endsWith('.md')`. Confirmed by
   construction, not by reading the code alone: added `scripts` to this repo's own `roots` in a
   scratch copy of `.cairnrc.json` and ran the real bundled CLI (`npx tsx src/cli.ts check
--summaries-only`) — the reported counts (`20 summary/ies checked`, `8 doc(s) checked`, `40
file(s) checked`) were BYTE-IDENTICAL with and without `scripts` in `roots`, proving zero files
   under `scripts/` are ever discovered regardless of `roots` configuration. This is categorically
   different from every prior negative result in this file (`README.md`/`docs/architecture.md` in
   section 2 above: real `.md` files, just outside `roots` — a one-line config change away from
   being scanned): there is no config knob that makes `scripts/*.ts` visible to `cairn` at all.
2. **Even granting that blocker away** (a hypothetical future "scan non-Markdown source" mode):
   `checks.coverage`'s actual mechanism is extracting real Markdown link syntax (`[text](path)`)
   from a doc body and matching hrefs against a target kind's selector — TypeScript/bash source
   has no such syntax. What these scripts DO cite between each other is bare prose in comments
   (`bench-guard.sh`: `"Read from a shared file, not inlined here — .github/workflows/bench.yml
needs the EXACT same filter"`) — structurally the exact shape `--prose-refs` already targets.
   But `--prose-refs` is ALSO markdown-scoped: confirmed by reading `CheckProseRefs.ts`, which
   calls the same `listMarkdownFiles` helper as every other check. So even the one, already-
   shipped, lower-bar mechanism built for exactly this citation shape cannot reach a code comment
   either — not a new gap, the SAME structural fact as finding 1, re-confirmed from a second angle.
3. **Even granting both of the above away entirely**: the real relationship these scripts have to
   each other (`bench-guard.sh`'s hot-path filter must stay identical to `.github/workflows/
bench.yml`'s own copy; `scripts/coverage-metrics.ts`'s printed numbers must stay identical to
   what `docs/design/CONVENTION.md` quotes from it) is a CODE/CONTENT-DUPLICATION-DRIFT concern —
   "these two literals must stay textually identical" — not a doc-completeness concern
   (`checks.coverage`) or a temporal-staleness concern (`checks.freshness`). Neither check's rule
   model has a "these two values must match" primitive; `checks.coverage` can only ever ask "does
   a link exist," and forcing THIS relationship into a link-existence check would produce exactly
   the hollow/gamed-link failure the structure-invitation prompt's own self-critique step warns
   against (a link from `bench-guard.sh` to `bench.yml` proves proximity, not that the two regexes
   actually still match).

**Revise**: no `checks.coverage` or `checks.freshness` structure proposed. A genuine negative
result, but for a more fundamental reason than any prior corpus in this file: `docs/design/`,
`docs/adr/`, and `README.md`/`docs/architecture.md` were all "right file type, not yet configured
or not yet linked" gaps; `scripts/*.ts` is "wrong file type entirely, structurally unreachable by
`cairn`'s own file discovery," confirmed by real CLI dogfood (identical scan counts with `scripts`
in `roots` and without), not merely reasoned about. Also explicitly named rather than silently
dropped, per the prompt's own requirement to list what defies categorization: the
`check-changeset.sh`/`check-changeset.integration.test.ts` pairing has no naming convention even a
hypothetical future glob-based kind selector could target uniformly (different extensions, `.sh`
paired with `.test.ts`, unlike `coverage-metrics.ts`/`coverage-metrics.unit.test.ts`'s clean
same-stem pair) — a real inconsistency worth a human noticing on its own merits, not something
this exercise should force a structure onto.

### `.changeset/*.md`

**The real corpus**: 14 files total in `.changeset/` (confirmed by `ls`) — `config.json` (a
Changesets tool file, not authored prose, excluded from the corpus below) plus 13 real changeset
`.md` files, each with
YAML frontmatter — either `'@sledorze/cairn': minor`, `'@sledorze/cairn': patch`, or empty
(`---\n---`, a docs-only "empty changeset," Changesets' own convention for a user-facing-adjacent
change that needs no version bump).

**Draft**: kind `changeset` (`.changeset/*.md`); considered a second kind mirroring
`docs/adr/`'s own `by: frontmatter` precedent (section 1 above: `{ by: "frontmatter", field:
"status", equals: "accepted" }`) to distinguish a real version-bumping changeset from a docs-only
one, plus a rule requiring each real (non-empty) changeset to link the GitHub issue or PR it
originates from, mirroring `problem-space.md`'s own `traces_to` rule (`CONVENTION.md`).

**Self-critique — checked against the real content of all 13 files, not assumed:**

1. **Zero real Markdown links exist in this corpus at all.** `grep -n '\[.*\](' .changeset/*.md`
   returns nothing — every citation in every changeset (`docs/design/CONVENTION.md`, `AGENTS.md`,
   `.claude/skills/cairn-design-package/SKILL.md`, `docs/design/review-prompts.md`'s own section
   4, ...) is a bare backtick reference, never `[text](path)`. This is the SAME finding section
   2's negative result already made for `README.md` — not new to this corpus, but re-confirmed
   from a second, independent corpus, which is itself evidence (per this file's own section 1
   closing observation: "a gap general enough to recur across two unrelated domains is more likely
   a fundamental one than a domain-specific artifact" — here applied to an absence-of-links
   pattern, not a schema gap, but the same generalization logic).
2. **The frontmatter-classification idea, which looked promising by analogy to `docs/adr/`,
   doesn't actually transfer.** `docs/adr/`'s `status` field is a FIXED key with varying values
   (`accepted`/`proposed`) — exactly what `KindSelector`'s `by: 'frontmatter'` variant (`field`,
   `equals`) was built to match. A changeset's frontmatter key is not fixed at all: it IS the
   package name (`'@sledorze/cairn'`), varying per changeset only in this repo's own case because
   there's currently exactly one published package — pointing a selector's `field` at
   `'@sledorze/cairn'` literally would silently stop working the moment this repo (or a template
   copying this convention) ever publishes a second package. And the "docs-only" case isn't a
   field/value pair to match at all — it's the ABSENCE of any frontmatter key, a selector shape
   `KindSelector`'s two current variants have no way to express (`by: 'path'` can't see frontmatter
   content; `by: 'frontmatter'` requires naming a `field` to check, not detecting its absence).
3. **Not in `roots`** (`.cairnrc.json`'s `roots: ["docs"]`) — confirmed by real CLI dogfood, not
   assumed: adding `.changeset` to a scratch copy of `roots` and running `npx tsx src/cli.ts check
--summaries-only` for real reports `❌ 1 summary/ies to (re)generate` — `.changeset/_SUMMARY.md`
   missing 13 child links — proving these ARE real, scannable `.md` files once in `roots` (a
   structurally different, less fundamental gap than `scripts/*.ts`'s complete invisibility above),
   just outside the configured scan today, the same shape as section 2's `README.md` finding, not
   a new discovery.
4. **No real second kind exists in the CURRENT content to justify a `traces_to`-style rule.**
   `grep -n "github.com" .changeset/*.md` finds exactly two hits, both inside `coverage-to-
alternation.md`/`coverage-external-url-target.md`'s own illustrative JSON code-sample text
   (`"pattern": "https://github.com/OWNER/REPO/issues/"`, a placeholder documenting the `{
external: 'url', pattern }` shape itself) — not a real citation of an originating issue or PR,
   the exact same "illustrative example string, not a real link" pattern section 2 already found
   in `README.md`'s own `[intro](./guide.md#getting-started)`. Proposing a `traces_to` rule here
   would invent the fact pattern the prompt's own instructions explicitly forbid ("do not propose
   a kind or rule because it sounds like a standard category... if nothing in the given material
   actually needs it").

**Revise**: no `checks.coverage` structure proposed — a second genuine negative result, but for a
THIRD, distinct reason from both prior negative results in this file: right file type (`.md`,
unlike `scripts/*.ts` above), real per-file structure worth noticing (frontmatter distinguishing
versioned from docs-only changesets), but (a) outside `roots`, the same specific gap `README.md`
already demonstrated, not new; (b) that real frontmatter structure doesn't fit `KindSelector`'s
existing `by: 'frontmatter'` shape, which needs a FIXED field name and cannot express "frontmatter
is absent" — a genuine, newly-surfaced schema-expressiveness observation, though not promoted to
`CONVENTION.md`'s tracked-gap list here since (matching that list's own discipline) it hasn't yet
been independently corroborated by a second real, concrete request; (c) zero real cross-doc link
relationships exist in ANY of the 13 files to structurally enforce, so there is no genuine
grounded rule to write regardless of (a) or (b). What IS a real, evidenced fit, exactly as
section 2 found for `README.md`: the bare-backtick citations are precisely `--prose-refs`'s target
shape, and — dogfooded for real, both directions, not just asserted — it works: with `.changeset`
temporarily added to `roots`, `npx tsx src/cli.ts check --prose-refs` reports `✅ No drifted prose
file-references found (49 file(s) checked)` against the real, current corpus; deliberately
corrupting one real citation (`coverage-scope-under.md`'s `docs/design/review-prompts.md`
citation, edited in place to append a bogus "-RENAMED" suffix before the extension so it no
longer resolves) makes the same command report exactly one drifted prose file-reference, naming
the now-unresolvable path and suggesting a real link as the fix; reverting
the corruption restores the clean report. Not wired into this repo's real `.cairnrc.json` here —
same reasoning `checks.freshness` (section 5) already applied to its own dogfooding decision:
widening `roots` to `.changeset` has consequences out of this task's scope (e.g. `.changeset/
_SUMMARY.md` now becomes a required doc under this repo's own summary-tree convention) not
evaluated here, and this task's own instruction was to investigate genuinely, not to wire in
whatever proves positive.

### Adversarial steelman pass on both conclusions (per `docs/design/review-prompts.md`'s own

discipline, applied to this section's own findings before finalizing)

- _`scripts/*.ts`'s "structurally unreachable" verdict, steelmanned as overstated_: could `cairn`
  simply be extended to scan other extensions, making this a configuration gap like every other
  one in this file, not a fundamental one? Partially holds: `listMarkdownFiles`'s `.md` filter
  is itself just a hardcoded string in ONE function — not a deep architectural wall — so "cairn
  could theoretically scan `.ts` files" is true in the sense that any software gap is theoretically
  closeable. It does NOT hold as a reason to downgrade this round's verdict: even if that filter
  were widened, blockers 2 and 3 above (no Markdown link syntax in source; the real relationship
  being content-duplication-drift, not doc-completeness) are independent of file-extension
  filtering and would remain exactly as blocking. The steelman narrows WHY this is a negative
  result (not "impossible," but "three independent blockers deep, the first of which has no
  existing config knob") without overturning the negative result itself.
- _`.changeset/*.md`'s "no real second kind" finding, steelmanned as premature_: could a THIRD
  kind — not a package-bump frontmatter split, not a GitHub-issue link, but something like "the
  design-package or ADR this changeset's underlying change came from" — be grounded in real
  content instead? Checked directly: no changeset in this corpus cites a `docs/design/*/` path or
  a `docs/adr/*.md` path at all (re-grepped for either prefix across all 13 files: only
  `coverage-scope-under.md` cites `docs/design/review-prompts.md`'s section 4, a bare backtick,
  already counted in finding 1 above). The steelman does not hold — there is no real, present
  citation pattern to a design-package or ADR kind either, so this would be the same "inventing
  the fact pattern" failure finding 4 already named, just with a different target kind.
- _Both corpora's "genuine negative result" framing, steelmanned as an artifact of WHICH corpora
  were chosen rather than a real property of dev-tooling/changelog domains in general_: would a
  DIFFERENT dev-tooling or changelog corpus (a different repo's `scripts/`, a project using
  Conventional Commits instead of Changesets) produce the same negative result, or is this
  specific to cairn's own two corpora? Cannot be fully settled without testing a second repo (out
  of this task's scope), but the STRUCTURAL blockers found — "no config knob reaches non-Markdown
  source at all" (blocker 1) and "zero real cross-doc links exist in this file format's actual
  convention" (finding 1) — are properties of the FILE FORMATS involved (TypeScript/bash source;
  Changesets' own single-purpose frontmatter+prose convention), not idiosyncrasies of this
  specific repo's content the way, say, `docs/adr/`'s missing architecture-doc links were a
  repo-specific drift. This makes the negative result more likely to generalize than not, but
  recorded here as a reasoned inference, not verified against a second repo — an honest limit on
  this round's own evidence, not overstated as settled.

**Verdict.** Both corpora produced genuine, evidenced negative results — no forced fit in either
direction — continuing this file's own standing discipline (section 2's `README.md` finding) of
reporting a clean "no" as real, useful evidence rather than treating only positive closures as
worth recording. `scripts/*.ts` fails for the most fundamental reason found in this file to date:
not a missing config, a missing FILE-TYPE capability, confirmed by real CLI dogfood (identical
scan counts with and without it in `roots`). `.changeset/*.md` fails for a shallower, more
familiar reason (in-corpus-type but outside `roots`, no real links, matching `README.md`'s own
section-2 shape) plus one genuinely new, not-yet-promoted schema observation (`KindSelector`'s
frontmatter variant cannot express "field is absent," nor a dynamic/wildcard field name) found
along the way. Both corpora's fit for the ALREADY-shipped, lower-bar `--prose-refs` mechanism was
dogfooded for real, both directions (clean pass, then a constructed failure, then reverted) rather
than merely asserted — the steelman pass found no reason to overturn either negative result, only
to sharpen why each one holds.
