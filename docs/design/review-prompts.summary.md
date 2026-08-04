# Review prompts — summary

Two business-agnostic prompts for applying cairn's `checks.coverage` (kinds/rules) to any
documentation domain, not just software design packages.

**1. Structure invitation**: given a domain and real source documents, asks an AI to
propose `kinds`/`rules` config grounded in the actual content provided — every kind/rule
must cite the specific document that justifies it and state a concrete consequence of the
link being missing; forbids proposing generic categories (e.g. "requirements", "risks")
with no basis in the given material; requires flagging anything that doesn't map cleanly
onto the schema.

**2. Adversarial judge**: given a proposed or existing structure plus its real enforced
content, instructs refutation (not confirmation) of two claims — (a) content adequacy: does
each kind's real document instance actually serve its stated purpose, verified by reading
actual text, not just checking the link exists; (b) schema expressiveness: attempt to
express 3+ concrete domain needs as valid `checks.coverage` config against the real
`KindSelector`/`CoverageTarget`/`CoverageRequirement`/`CoverageRule.scope` types, and report
each failure as schema-fundamental versus merely unconfigured. Both prompts require quoted
evidence and end with measurable, re-checkable criteria rather than a prose-only verdict.

**3. Worked example**: both prompts applied for real to `docs/adr/` (a corpus different from
`docs/design/`) — proposed a `by: "frontmatter"` kind (classifying by each ADR's real
`status: proposed`/`accepted` field, since path alone can't distinguish them) plus a rule
requiring every accepted ADR be linked from `docs/architecture.md`; the adversarial pass
found this classification-by-frontmatter gap was schema-fundamental (closed in this same
task — `KindSelector` gains a `by: "frontmatter"` variant) and re-confirmed two gaps
`CONVENTION.md` already knew about (no date/freshness rule, no URL-pattern target). Verdict:
validates that the prompts generalize to a genuinely different domain.
