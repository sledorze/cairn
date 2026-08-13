# Reusable prompts for designing and judging a `checks.coverage` structure

Three prompts for applying cairn's `checks.coverage` (kinds/rules) to any domain's
documentation, not just software design packages. All are business-agnostic: they take a
domain and real source material as input, and neither assumes the reader already knows what
`docs/design/` or "design package" means.

Real, dated evidence from applying both prompts — to `docs/design/`, `docs/adr/`, and
several rounds of closing gaps found along the way — lives in
[`review-findings.md`](./review-findings.md), split into its own file precisely because it
grows every round while the two prompts below rarely change; see that file's own opening
note for why.

**A single, static prompt text handed to one agent call that reads it once and responds
once is NOT itself a multi-step reflective process** — reflection has to come from
somewhere. It can be baked into the prompt's own instructions as an internal
propose→critique→revise loop the agent is explicitly told to run before answering (what
both prompts below now do), or it can be provided externally by re-invoking the same
prompt across genuinely separate, context-free agent calls (what the worked example in
`review-findings.md`'s section 1 does across its several rounds). Both are worth doing, and
for different reasons: the internal loop makes any single call more rigorous even in
isolation, while re-invoking externally catches blind spots the same agent's own
self-critique is structurally unlikely to notice, since it's still the same reasoning that
produced the first draft doing the critiquing.

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

## 3. Problem-space rationalization — refute the current framing before writing (or rewriting) problem-space.md

The two prompts above both assume a `docs/design/<slug>/` package already exists and take
its scope as given — "what structure fits this content." This prompt asks a prerequisite
question neither of them does: **is the framing of the problem itself even correct**, before
anyone commits words to a solution built on top of it. Use it before writing
`problem-space.md` for a new initiative, or to re-examine an EXISTING one whose scope was
never actually stress-tested — the trigger that motivated this prompt: applying it for real
against this repo's own `docs/design/*/roadmap.md` files found a genuine boundary violation
(one package's roadmap asserting a DIFFERENT package's release priority — "ADR 0004's own
Release 1 ... should ship first regardless of this design's fate" — a claim `checks.coverage`'s
own `scope: "sibling"` rules structurally cannot see or check, because it crosses a package
boundary the schema has no vocabulary for) and a self-admitted vocabulary mismatch
(`CONVENTION.md`'s own Claim 1: "`roadmap.md`'s rationale is dependency sequencing, not
business tradeoff" — noted as a content gap there, never followed to its placement
consequence). This prompt exists to catch that class of problem systematically, not rely on
noticing it by accident while reading something else.

Run it as a fresh, context-free reviewer wherever possible — the person who scoped the
initiative is poorly positioned to refute their own scoping.

> You are rationalizing the PROBLEM SPACE for **[INITIATIVE/ISSUE]**, given: the existing
> (or draft) framing — **[PASTE problem-space.md, or the informal description if none exists
> yet]** — and the real evidence available — **[LINK OR PASTE: issues, incident reports,
> existing docs that touch this problem, related design packages]**.
>
> Do NOT propose a solution. Do NOT draft kinds/rules or a document structure. Your only job
> here is to determine whether the problem, AS CURRENTLY FRAMED, is the real problem —
> before anyone commits words to a solution built on top of it.
>
> Try to REFUTE each of the following claims about the current framing. Default to
> refuting, not confirming — a claim survives only if you cannot construct a real
> counter-example against it.
>
> **(a) Scope correctness**: "the initiative's declared scope (what it says it will and
> won't touch) is the actual boundary of the problem, not an artifact of where someone
> happened to start writing." Look for evidence the real problem crosses the stated
> boundary — a claim, decision, or piece of reasoning that logically belongs to this
> problem but is scoped to live somewhere else (a different doc, a different package, a
> different layer), or the reverse: content inside the current scope that actually belongs
> to a DIFFERENT, already-existing problem/package. Quote the specific passage that crosses
> the boundary, and name where it actually belongs.
>
> **(b) Evidence sufficiency**: "the evidence cited for this being a real, worth-solving
> problem is strong enough to justify the investment implied by the framing." Classify each
> piece of cited evidence (a filed issue, an incident, a person's stated pain) by how
> corroborated it is — one person's single report is not the same strength as a
> reproduced-and-confirmed incident, which is not the same as a pattern recurring across
> independent contexts. State plainly if the framing's implied investment (a new module, a
> new config surface, a multi-release roadmap) is disproportionate to the evidence's actual
> strength — this repo's own recurrence-gate lesson (`AGENTS.md`) is precedent: ask "has
> this happened more than once, independently?" before any design investment, not after.
>
> **(c) Vocabulary honesty**: "the words used to describe this problem and its artifacts
> (the doc's own filename, section headers, key terms) mean what they claim to mean here."
> For each product- or process-sounding term borrowed into the framing (e.g. "roadmap,"
> "story map," "persona," "risk"), check whether the content under that heading actually
> matches the term's ordinary meaning, or is a narrower/different thing wearing that label.
> Quote the mismatch, don't just assert it.
>
> **(d) Placement correctness**: "the documents/artifacts this problem's solution will
> produce belong in the location the framing assumes (which directory, which package,
> sibling-scoped vs. top-level, one doc vs. many)." Check for information that's
> cross-cutting (spans multiple initiatives, packages, or time horizons) being forced into a
> single-package-scoped location, or the reverse — genuinely single-scoped content inflated
> into a shared/top-level location it doesn't need. This is a distinct claim from (a): (a)
> is about the PROBLEM's logical boundary; (d) is about where the eventual DOCUMENTS live,
> which can diverge from the problem's own boundary even when (a) holds — this repo's own
> roadmap finding above is a (d) violation, not an (a) violation: the PROBLEM each package
> solves is correctly scoped to that package; only the cross-package SEQUENCING CLAIM living
> inside one package's file is misplaced.
>
> For every claim (a)-(d): cite concrete, quoted evidence — file, line, or passage — for
> each finding, refuted or surviving. A claim that survives your attempt to refute it should
> say so explicitly, with what you tried and why it held.
>
> Take a second, explicit pass, per this repo's own steelman discipline (this file's
> Adversarial judge prompt above): for each claim you just refuted, argue the STRONGEST case
> that your refutation is wrong — that the original framing was actually fine, and what
> looks like a boundary/evidence/vocabulary/placement problem is actually deliberate, or
> harmless, or already handled elsewhere you didn't check. Update your verdict only where
> the steelman genuinely holds; otherwise state why it doesn't, citing evidence again.
>
> End with:
>
> - a list of every claim (a)-(d), each marked SURVIVED or REFUTED, with its one-line reason;
> - for each REFUTED claim, a concrete rewrite instruction (not a full rewrite) — the
>   smallest correction to the framing that would make the claim survive, e.g. "move X's
>   cross-package sequencing claim out of this package's roadmap.md into a new top-level
>   doc" or "rename this section, its content is Y not Z";
> - an explicit statement of which claims you could NOT fully check (evidence you didn't
>   have access to) rather than silently treating them as survived.
