# Review prompts — summary

Two business-agnostic prompts for applying cairn's `checks.coverage` (kinds/rules) to any
documentation domain, not just software design packages.

**Finding stated up front**: a single, static prompt handed to one agent call that reads it
once and answers once is not itself a multi-step reflective process. Reflection must come
from either (a) an internal propose→critique→revise loop baked into the prompt's own
instructions, or (b) an external orchestrator re-invoking the same prompt across genuinely
separate, context-free agent calls — ideally both, since (a) strengthens a single call and
(b) catches blind spots that call's own self-critique is structurally unlikely to see.

**1. Structure invitation**: given a domain and real source documents, asks an AI to
propose `kinds`/`rules` config grounded in the actual content provided. Now runs as an
explicit three-step internal loop reported as three visible sections: draft a first-pass
structure, self-critique it (what would make it fail, be gamed, or miss a real
document/relationship), then revise in direct response before presenting the revised
structure as the final answer. Every kind/rule must cite the specific document that
justifies it and state a concrete consequence of the link being missing; forbids proposing
generic categories (e.g. "requirements", "risks") with no basis in the given material;
requires flagging anything that doesn't map cleanly onto the schema.

**2. Adversarial judge**: given a proposed or existing structure plus its real enforced
content, instructs refutation (not confirmation) of two claims — (a) content adequacy: does
each kind's real document instance actually serve its stated purpose, verified by reading
actual text, not just checking the link exists; (b) schema expressiveness: attempt to
express 3+ concrete domain needs as valid `checks.coverage` config against the real
`KindSelector`/`CoverageTarget`/`CoverageRequirement`/`CoverageRule.scope` types, and report
each failure as schema-fundamental versus merely unconfigured. After a first-pass verdict
on (a) and (b), the prompt now requires a second, visible pass that steelmans the opposite
of each just-stated finding before finalizing — updating the verdict where the steelman
holds, and explaining why it doesn't where the finding stands. Before writing up (b), the
prompt instructs running `pnpm run coverage-metrics` (`scripts/coverage-metrics.ts`) and
citing its real printed output for the schema variant/hedge-language censuses, instead of
hand-counting them by reading the schema file — the other four measurable checks are still
hand-derived per domain. Both prompts require quoted evidence and end with measurable,
re-checkable criteria rather than a prose-only verdict.

**3. Worked example**: both prompts applied for real to `docs/adr/` (a corpus different from
`docs/design/`) — proposed a `by: "frontmatter"` kind (classifying by each ADR's real
`status: proposed`/`accepted` field, since path alone can't distinguish them) plus a rule
requiring every accepted ADR be linked from `docs/architecture.md`; the adversarial pass
found this classification-by-frontmatter gap was schema-fundamental (closed in this same
task — `KindSelector` gains a `by: "frontmatter"` variant) and re-confirmed two gaps
`CONVENTION.md` already knew about (no date/freshness rule, no URL-pattern target). Verdict:
validates that the prompts generalize to a genuinely different domain.

**4. `scope: { under: '...' }`, and a negative result against `README.md`/`docs/architecture.md`**:
closes `CONVENTION.md`'s named sibling/corpus-wide granularity gap — `scope` gains a second
variant, satisfied by a `to`-kind doc nested anywhere below a given project-relative
directory, additive alongside `'sibling'`. Applying the structure-invitation prompt for real
to this repo's own `README.md` + `docs/architecture.md` (the only two top-level docs)
produced a genuine NEGATIVE result — no `checks.coverage` structure proposed: the corpus has
no multiplicity (one README, one architecture doc, not many repeating instances), `README.md`
has zero real Markdown links to any other doc, and the one real gap found (a bare-backtick
citation of `CONVENTION.md`) is `--prose-refs`-shaped, not `checks.coverage`-shaped — and
`README.md` isn't even inside this repo's own scanned `roots` today. The adversarial pass on
the new `{ under }` capability itself found it closes the stated gap cleanly (verified by real
CLI dogfood and a falsified dedup-key regression test, "Round 5" of `CheckCoverage.ts`'s own
recurring bug), but surfaced one new, narrower, un-closed gap: `under` has no validation
against the config's real `roots`, unlike `from`/`to` kind ids.

**5. Closing `under`-vs-`roots`, and `to` alternation (N-of-M/OR)**: `under` is now validated
at `checkCoverage` RUN time, not decode time (`roots`/`checks.coverage` can live in different
`extends` layers, so no single-layer decode sees both) — a typo'd or out-of-corpus `under` now
surfaces as a non-fatal `emptyScopeUnders` warning, mirroring `unmatchedKinds`'s own precedent;
dogfooded both directions with the real CLI. Separately, `to` may now be a non-empty ARRAY of
targets, satisfied by a link matching ANY ONE of them (`targetsOf`) — closes the OR/alternation
reading of the N-of-M gap, additive, "Round 6" of the dedup-key's recurring bug fixed alongside
it. An independent, context-free adversarial pass (a fresh agent given only the diff) found no
crash or silent-wrong-pass bug in either; found two low-severity, non-exit-code cosmetic dedup
edge cases (order-sensitive array `to`, untrimmed-vs-trimmed `under` dedup) left unfixed and
recorded, and one pre-existing (not newly introduced) JSON-Schema `minItems` discoverability gap
shared with the existing `under` non-empty check. General N-of-M cardinality (not just OR) stays
open, recorded explicitly rather than claimed closed by the narrower alternation shipped here.

**6. Closing general N-of-M/`atLeast`, a systematic vacuity-safeguard table, and this file's
own adversarial-judge prompt run against both**: closes the narrower N-of-M reading section 5
left open — `to` gains `{ atLeast: { n, of } }`, satisfied when at least `n` of `of`'s targets
EACH have their own link (not `n` links to the same one); `{ any: [...] }` is added as the
explicit, named spelling of the array form, additive alongside it. `RuleEdge` gains a
`satisfied` field (`satisfiedBy.length > 0` alone can't answer "is this rule met" once a
MINIMUM COUNT is possible); dogfooded both directions with the real CLI; "Round 7" of the
dedup-key's standing recurring-bug warning checked and found NOT triggered (no new top-level
`CoverageRule` field was added). Since `fast-check` is confirmed absent from `package.json`, Part
B's systematic vacuity safeguard is a table-driven test (`VacuousShapes.unit.test.ts`) covering
`**` matching zero segments (a deliberate non-fix — that's a real, already-used feature
elsewhere in this codebase, not a defect), empty `scope.under`, an empty `to` array, and the new
`atLeast.n`/`of` edge cases. Running this file's own adversarial-judge prompt (with its steelman
second pass) against this task's own work surfaced a REAL bug its first-pass self-review had
missed: a DUPLICATE target in `atLeast.of` let one real link count toward `n` twice — proved
concretely (`resolveRuleEdges` returning `satisfied: true` for `n: 2` with only one real link),
fixed at decode time before commit (`checkAtLeastSane` now rejects a structurally-duplicate
`of` entry), and falsified both directions. The schema-expressiveness pass found one genuinely
new fundamental gap (no relative/scaling `n`, e.g. "a majority of `of`") not yet promoted into
`CONVENTION.md`'s tracked list, and one configuration-only cost (a per-doc minimum needs one
extra rule per distinct value) whose steelman pass showed real ergonomic friction the first pass
had understated. The pre-existing JSON-Schema cross-field-constraint gap (section 5's own
`minItems` finding) is re-confirmed, not newly introduced, for `atLeast`'s three struct-level
checks.

**7. Closing the dates/mtimes gap — `checks.freshness`, its falsestart origin, and real
dogfood evidence**: closes `CONVENTION.md`'s remaining named gap ("nothing in the schema
touches dates/mtimes"), as its own separate `checks.freshness` check rather than a
`CoverageRule` field — a TEMPORAL axis, not the RELATIONAL one every prior section closed.
Origin is real, not invented for this task: GitHub issue #101 ("found using cairn 0.6.0 in
`sledorze/falsestart`") — `--refs` failed on every edit to any of 14 cited implementation
files even when a doc's own claims hadn't changed; `checks.freshness` is the adjacent concept
issue #101 named in passing, built as its own thing, orthogonal to `--refs`'s own
citation-drift detection. Shape: `{ rules: [{ glob, maxAgeDays }] }`, first-matching-glob-wins,
checked against `io/Git.ts`'s real committer date (`lastCommitDate`, never filesystem mtime,
`null` for a doc with no history yet — silently excluded, not reported). Dogfooded for real
with the bundled CLI against a throwaway `.cairnrc.json` copy (`maxAgeDays: 1`): correctly
flagged this repo's own older ADR docs as stale with accurate `(Nd > 1d)` ages, stayed silent
on recently-touched docs, then reverted rather than committed — this repo's own docs have no
real "silently rotted and nobody noticed" incident to ground a permanent threshold in, unlike
the repo that motivated the check, so it stays available but NOT enabled in this repo's own
config. New tests: `Freshness.unit.test.ts` (pure staleness logic, strict `>` boundary),
`CheckFreshness.unit.test.ts`/`.plugin.unit.test.ts` (IO-level wiring, `GitUnavailableError`
treated as no-history), and a new `GitFsLive().lastCommitDate()` block in
`Git.integration.test.ts` against the real `git` binary.
