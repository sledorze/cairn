# Review prompts — summary

Two business-agnostic prompts for applying cairn's `checks.coverage` (kinds/rules) to any
documentation domain, not just software design packages. Real, dated evidence from actually
running both prompts (against `docs/design/`, `docs/adr/`, and several rounds of closing
schema gaps) lives separately in [`review-findings.md`](./review-findings.md) — split out
from this file once that evidence grew past a lean reference, the same doc-role split this
repo already applies to `CONVENTION.md` versus [`docs/adr/0005-design-packages-structurally-enforced-by-existing-coverage.md`](../adr/0005-design-packages-structurally-enforced-by-existing-coverage.md).

**Finding stated up front**: a single, static prompt handed to one agent call that reads it
once and answers once is not itself a multi-step reflective process. Reflection must come
from either (a) an internal propose→critique→revise loop baked into the prompt's own
instructions, or (b) an external orchestrator re-invoking the same prompt across genuinely
separate, context-free agent calls — ideally both, since (a) strengthens a single call and
(b) catches blind spots that call's own self-critique is structurally unlikely to see.

**1. Structure invitation**: given a domain and real source documents, asks an AI to
propose `kinds`/`rules` config grounded in the actual content provided. Runs as an explicit
three-step internal loop reported as three visible sections: draft a first-pass structure,
self-critique it (what would make it fail, be gamed, or miss a real document/relationship),
then revise in direct response before presenting the revised structure as the final answer.
Every kind/rule must cite the specific document that justifies it and state a concrete
consequence of the link being missing; forbids proposing generic categories (e.g.
"requirements", "risks") with no basis in the given material; requires flagging anything
that doesn't map cleanly onto the schema.

**2. Adversarial judge**: given a proposed or existing structure plus its real enforced
content, instructs refutation (not confirmation) of two claims — (a) content adequacy: does
each kind's real document instance actually serve its stated purpose, verified by reading
actual text, not just checking the link exists; (b) schema expressiveness: attempt to
express 3+ concrete domain needs as valid `checks.coverage` config against the real
`KindSelector`/`CoverageTarget`/`CoverageRequirement`/`CoverageRule.scope` types, and report
each failure as schema-fundamental versus merely unconfigured. After a first-pass verdict
on (a) and (b), the prompt requires a second, visible pass that steelmans the opposite of
each just-stated finding before finalizing — updating the verdict where the steelman holds,
and explaining why it doesn't where the finding stands. Before writing up (b), the prompt
instructs running `pnpm run coverage-metrics` (`scripts/coverage-metrics.ts`) and citing its
real printed output for the schema variant/hedge-language censuses, instead of hand-counting
them by reading the schema file — the other four measurable checks are still hand-derived
per domain. Both prompts require quoted evidence and end with measurable, re-checkable
criteria rather than a prose-only verdict.
