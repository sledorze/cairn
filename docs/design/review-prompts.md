# Reusable prompts for designing and judging a `checks.coverage` structure

Two prompts for applying cairn's `checks.coverage` (kinds/rules) to any domain's
documentation, not just software design packages. Both are business-agnostic: they take a
domain and real source material as input, and neither assumes the reader already knows what
`docs/design/` or "design package" means.

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
> Requirements:
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
> For both (a) and (b): cite concrete, quoted evidence for every finding — no vibe-only
> judgment. End your report with a fixed set of measurable, re-checkable criteria (not
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
