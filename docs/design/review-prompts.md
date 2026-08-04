# Reusable prompts for designing and judging a `checks.coverage` structure

Two prompts for applying cairn's `checks.coverage` (kinds/rules) to any domain's
documentation, not just software design packages. Both are business-agnostic: they take a
domain and real source material as input, and neither assumes the reader already knows what
`docs/design/` or "design package" means.

**A single, static prompt text handed to one agent call that reads it once and responds
once is NOT itself a multi-step reflective process** — reflection has to come from
somewhere. It can be baked into the prompt's own instructions as an internal
propose→critique→revise loop the agent is explicitly told to run before answering (what
both prompts below now do), or it can be provided externally by re-invoking the same
prompt across genuinely separate, context-free agent calls (what the worked example in
section 3 does across its several rounds). Both are worth doing, and for different
reasons: the internal loop makes any single call more rigorous even in isolation, while
re-invoking externally catches blind spots the same agent's own self-critique is
structurally unlikely to notice, since it's still the same reasoning that produced the
first draft doing the critiquing.

## 1. Structure invitation — propose a `checks.coverage` structure from real content

Use this prompt to get a first `kinds`/`rules` structure for a new documentation domain,
grounded in documents that actually exist rather than a generic template.

> You are designing a `checks.coverage` structure (cairn's kinds/rules doc-coverage
> feature) for **[DOMAIN]**. You are given the following real source documents/inputs:
> **[LIST OR PASTE THE ACTUAL DOCS/INPUTS]**.
>
> Propose a set of `kinds` (each a named category of document, matched by path glob or
> other selector) and `rules` (each a required link from one kind to another, optionally
> scoped to `sibling` or left corpus-wide) that would structurally enforce this domain's
> documentation being complete and connected.
>
> Do this as an explicit three-step internal process — do not skip straight to a final
> answer:
>
> 1. **Draft**: propose a first-pass `kinds`/`rules` structure grounded in the given
>    material.
> 2. **Self-critique**: before presenting that draft as your answer, adversarially
>    interrogate your OWN draft — ask yourself concretely: what would make this
>    structure fail to catch a real gap in this domain? Which rule could be satisfied
>    by a hollow or gamed link (e.g. a document linking to another purely to pass the
>    check, without the link meaning anything)? What real document or relationship in
>    the given material does this draft fail to cover? Write this critique out; do not
>    silently think it and move on.
> 3. **Revise**: change the draft in direct response to what step 2 found — add, remove,
>    rename, or rescope kinds/rules as needed — and present only the REVISED structure
>    as your final answer, not the original draft.
>
> Report the draft, the self-critique, and the revision as three distinct, visible
> sections — a final answer with no visible critique-and-revision step does not satisfy
> this prompt, even if the final structure happens to be good.
>
> Requirements for the final (revised) structure:
>
> - Ground every kind and rule in the actual content you were given — quote or cite the
>   specific document, section, or pattern that justifies each one. Do not propose a kind
>   or rule because it sounds like a standard category (e.g. "requirements", "risks") if
>   nothing in the given material actually needs it.
> - For each rule, state in one sentence WHY that link should be required — what breaks,
>   or what goes unverified, if the link is missing. If you cannot state a concrete
>   consequence, do not propose the rule.
> - Name each rule with a real relationship word (not `req1`/`rule_a`) and give it a
>   `description` that would make sense to someone hitting the failure report with no
>   prior context.
> - Produce the structure as valid `checks.coverage` config (a `kinds` array and a `rules`
>   array), not prose alone.
> - Explicitly list anything in the given material that does NOT map cleanly onto a
>   kind/rule — a document that defies categorization, or a relationship the schema can't
>   express (see the adversarial-judge prompt below for how to check this precisely) —
>   rather than silently forcing a fit.

## 2. Adversarial judge — refute a proposed or existing structure

Use this prompt to critique a `checks.coverage` structure (proposed or already enforced)
against real content. Run it as a fresh, context-free reviewer — a reviewer who proposed or
already believes in the structure is poorly positioned to find its gaps.

> You are adversarially reviewing a `checks.coverage` structure for **[DOMAIN]**: the
> `kinds`/`rules` config **[PASTE OR LINK IT]**, the schema it's built on
> (`KindSelector`, `CoverageTarget`, `CoverageRequirement`, `CoverageRule.scope` —
> `[LINK TO THE ACTUAL TYPE DEFINITIONS]`), and a real, currently-enforced document set
> **[LINK OR PASTE REAL DOCS THAT SATISFY THIS STRUCTURE TODAY]**.
>
> Try to REFUTE the following two claims. Do not confirm them by default — look
> specifically for where they fail.
>
> **(a) Content adequacy**: "the content this structure enforces actually serves its
> stated purpose, for its stated audience." For each kind's required document, read a real
> instance (not the config, the actual document text) and judge whether it does the job
> the kind's name implies, or merely exists to satisfy the link check. Quote the specific
> passage that supports your judgment either way. A document that is present and linked
> but hollow, generic, or copy-pasted from a sibling is a failure of this claim even
> though `checks.coverage` reports it as passing — `checks.coverage` only ever verifies
> link EXISTENCE, never the linked content's substance.
>
> **(b) Schema expressiveness**: "the underlying `checks.coverage` schema has the
> expressive capability for what this domain actually needs." Identify at least 3
> concrete, plausible requirements this domain has (drawn from the real documents, not
> invented) that are NOT yet expressed by the current config, and attempt to write each as
> valid `checks.coverage` config using the actual current schema. For each attempt, report
> whether it succeeds or fails, and if it fails, whether the failure is because the schema
> has no variant capable of expressing it (a fundamental gap) or because the config simply
> hasn't been written yet (a configuration gap, not a schema gap). Do not report a gap you
> have not attempted to actually express in config.
>
> Before writing up (b), run `pnpm run coverage-metrics` (`scripts/coverage-metrics.ts`
> in cairn's own repo) and cite its actual printed output — the schema variant census
> and hedge-language census — as evidence instead of hand-counting `Schema.Literal`/
> union variants by reading the schema file, or grepping hedge phrases yourself. This
> applies regardless of which domain's documents you're reviewing: the schema being
> judged (`KindSelector`, `CoverageTarget`, `CoverageRequirement`, `CoverageRule.scope`)
> is always cairn's own, so its variant count doesn't change per domain — only run the
> script fresh if you suspect the schema itself changed since its last run. The script
> covers only two of the six measurable checks below; still hand-derive the other four
> (product-signal lexicon ratio, persona audit, evidence-source classifier,
> self-reported-gap closure) against the domain's actual documents, but don't re-derive
> by hand what the script already computes for real.
>
> For both (a) and (b): cite concrete, quoted evidence for every finding — no vibe-only
> judgment.
>
> Once you have a full first-pass verdict for (a) and (b), do not finalize it yet. Take a
> second, explicit pass: for EACH finding you just stated (each judgment under (a), each
> schema-fundamental-vs-configuration-gap tag under (b)), argue the opposite — steelman
> the strongest case that your own finding is wrong. For a content-adequacy judgment,
> argue for why the document you called substantive might actually be hollow, or vice
> versa. For a schema-gap tag, argue for why a gap you called fundamental might actually
> be closeable with existing schema variants (or the reverse). Write this second pass out
> as its own visible section, one entry per finding, not a single blanket "on the other
> hand" paragraph. Only after this second pass should you commit to a final verdict per
> finding — where the second pass actually changes your mind, say so and update the
> verdict; where it doesn't, say why the steelman failed to hold up, citing evidence
> again rather than asserting it. A report with a first-pass verdict but no visible
> attempt to overturn it does not satisfy this prompt.
>
> End your report with a fixed set of measurable, re-checkable criteria (not
> prose alone) that a future reviewer — or an automated script — could re-run without
> reading every document again, for example:
>
> - a count of documents, per kind, whose content was actually read and judged substantive
>   versus merely present
> - a count of domain requirements attempted against the schema, and how many succeeded
>   versus failed, with each failure tagged schema-fundamental or configuration-only
> - a list of any schema-fundamental gaps found, to track whether they get closed or
>   remain open at the next review
>
> Report explicitly which parts of claims (a) and (b) hold and which do not — do not
> average them into a single vague verdict.

## 3. Worked example: applying both prompts to `docs/adr/`, a different corpus

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

## 4. `scope: { under: '...' }` — closing the sibling/corpus-wide granularity gap, and a

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
link — the exact same finding review-prompts.md's own section 3 already recorded for this
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

## 5. Closing the `under`-vs-`roots` validation gap, and `to` alternation (N-of-M/OR) — a second

round validated the SAME way

Two of Claim 2's remaining named gaps in one task: (a) `under` had zero validation against the
config's own `roots` (recorded open at the end of section 4 above); (b) `CoverageRequirement.by`
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
a description of both features, told to try to break them — same discipline as section 4's own
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
  language" discipline.
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
