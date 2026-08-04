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
