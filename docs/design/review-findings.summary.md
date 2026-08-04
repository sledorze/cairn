# Review findings — summary

Real, dated evidence from applying `review-prompts.md`'s two prompts (structure invitation,
adversarial judge) to this repo's own `checks.coverage` schema and configuration, across
nine rounds so far. Split out of `review-prompts.md` once this evidence grew past a lean
reference — an append-only historical record, mirrored by [`docs/adr/0005-design-packages-structurally-enforced-by-existing-coverage.md`](../adr/0005-design-packages-structurally-enforced-by-existing-coverage.md)'s own
Amendment log for the same rounds.

**1. Worked example**: both prompts applied for real to `docs/adr/` (a corpus different from
`docs/design/`) — proposed a `by: "frontmatter"` kind (classifying by each ADR's real
`status: proposed`/`accepted` field, since path alone can't distinguish them) plus a rule
requiring every accepted ADR be linked from `docs/architecture.md`; the adversarial pass
found this classification-by-frontmatter gap was schema-fundamental (closed in this same
task — `KindSelector` gains a `by: "frontmatter"` variant) and re-confirmed two gaps
`CONVENTION.md` already knew about (no date/freshness rule, no URL-pattern target). Verdict:
validates that the prompts generalize to a genuinely different domain.

**2. `scope: { under: '...' }`, and a negative result against `README.md`/`docs/architecture.md`**:
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

**3. Closing `under`-vs-`roots`, and `to` alternation (N-of-M/OR)**: `under` is now validated
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

**4. Closing general N-of-M/`atLeast`, a systematic vacuity-safeguard table, and this file's
own adversarial-judge prompt run against both**: closes the narrower N-of-M reading section 3
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
`atLeast.n`/`of` edge cases. Running `review-prompts.md`'s own adversarial-judge prompt (with its
steelman second pass) against this task's own work surfaced a REAL bug its first-pass self-review
had missed: a DUPLICATE target in `atLeast.of` let one real link count toward `n` twice — proved
concretely (`resolveRuleEdges` returning `satisfied: true` for `n: 2` with only one real link),
fixed at decode time before commit (`checkAtLeastSane` now rejects a structurally-duplicate
`of` entry), and falsified both directions. The schema-expressiveness pass found one genuinely
new fundamental gap (no relative/scaling `n`, e.g. "a majority of `of`") not yet promoted into
`CONVENTION.md`'s tracked list, and one configuration-only cost (a per-doc minimum needs one
extra rule per distinct value) whose steelman pass showed real ergonomic friction the first pass
had understated. The pre-existing JSON-Schema cross-field-constraint gap (section 3's own
`minItems` finding) is re-confirmed, not newly introduced, for `atLeast`'s three struct-level
checks.

**5. Closing the dates/mtimes gap — `checks.freshness`, its falsestart origin, and real
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

**6. Closing the JSON-Schema cross-field-constraint discoverability gap**: investigated for
real against `effect`'s own source (`toJsonSchemaDocument.ts`'s `compileCheck`) — a
`Schema.Filter` with no `toJsonSchema` annotation callback is unconditionally dropped from the
generated JSON Schema, confirmed by a standalone probe. The same probe found a real escape
hatch: a filter carrying even a no-op `toJsonSchema` callback DOES get its own `description`
merged in. A new `jsonSchemaHint` helper (`core/Config.ts`) applies this to all four cross-field
filters (`to` array non-empty, `atLeast`'s `n`/`of`, `under`'s non-empty check, and the
top-level undeclared-kind/description-mandatory check) — closing the DISCOVERABILITY half of
the gap, not the structural half (JSON Schema genuinely cannot express an arbitrary cross-field
predicate). Found and fixed a real pitfall along the way: `.annotate()` chained directly after
`.pipe(Schema.check(...))` on the same node silently overwrites the check's own description —
hit for real in `ScopeUnderPathSchema`, fixed by reordering. An independent adversarial pass
re-derived the bug independently, checked every other similarly-ordered site for the same latent
bug (none affected), confirmed no decode-time behavior changed, and found one purely cosmetic
doc-comment defect (fixed). Its steelman pass found one real, narrower follow-up: `atLeast.of`'s
no-duplicate check specifically could use `uniqueItems: true` structurally — not attempted here,
recorded as a genuine smaller open item.

**7. Closing that narrower `uniqueItems` follow-up — including a wrong first-pass assumption
caught by the coverage ratchet, not silently corrected**: `effect`'s built-in `Schema.isUnique()`
(confirmed via source — its own doc comment states it maps to `uniqueItems: true`) is now stacked
onto `atLeast.of`. Confirmed genuinely working: a standalone probe first proved the mechanism in
isolation, then the real `schema/cairn.schema.json` was regenerated and diffed
(`"of": { "allOf": [{ "uniqueItems": true }], ... }`), then — going further than any prior
`jsonSchemaHint` fragment's verification — compiled with a real, independent validator (`ajv`) and
confirmed it actually rejects a duplicate `atLeast.of` target and accepts a clean one, not just
that the keyword appears in the generated text. The first-pass assumption that `Schema.isUnique()`
is "strictly weaker" than the existing `atLeastSaneFilter` (reference equality, not structural) was
WRONG — running the real coverage pipeline surfaced a genuine regression (a newly-0%-covered
branch), which traced to `effect`'s `Equal.equals` actually being STRUCTURAL and key-order-
INSENSITIVE, making `Schema.isUnique()` a strict superset of the old `JSON.stringify` compare (and
fixing a real latent key-order bug in it) — and to field-level checks running before a struct's own
cross-field check, making the old duplicate branch permanently unreachable. Fixed by REMOVING that
now-dead branch (not suppressing the coverage gap), with `vitest.config.ts`'s `functions`/
`branches` thresholds manually recalibrated down by the resulting tiny amount, matching that same
file's own precedent for a denominator-only shift from dead-code removal. Steelman pass, re-run
against the corrected understanding: keeping both checks WOULD have been the real "redundant,
drifting mechanisms" failure; removing the subsumed one was the right call, verified to lose
nothing (every previously-rejected input still rejected) and gain a real fix (key-order-duplicate
objects, previously wrongly accepted, are now correctly caught). Does `allOf`-nesting actually get
honored by real tooling? Yes, verified with `ajv`. A real, pre-existing, unrelated `$schema`
dialect-string inconsistency (`draft-07` header vs. `Schema.toJsonSchemaDocument`'s own
`draft-2020-12` probe output) was noticed while building the `ajv` probe and recorded, not fixed
— out of this round's scope.

**8. Validating the structure-invitation prompt against `scripts/*.ts` (dev tooling) and
`.changeset/*.md` (a changelog convention)**: two more genuine negative results, continuing the
generalization-testing pattern (`docs/design/`, `docs/adr/`, `README.md`/`docs/architecture.md`
tried previously). `scripts/*.ts` + its `*.unit.test.ts`/`*.integration.test.ts` siblings fails
for the most fundamental reason found in this file to date — not a missing config, a missing
FILE-TYPE capability: `DocsFs.ts`'s `listMarkdownFiles`, the one file-discovery function every
check in this codebase shares, filters unconditionally on `.md`, confirmed by real CLI dogfood
(identical scan counts with and without `scripts` added to `roots`). Even granting that away
hypothetically, `checks.coverage` needs real Markdown link syntax no source file has, and even
granting THAT away, the real relationship between these scripts (two regex/number literals that
must stay textually identical, e.g. `bench-guard.sh`'s hot-path filter vs.
`.github/workflows/bench.yml`'s own copy) is a content-duplication-drift concern neither
`checks.coverage` nor `checks.freshness` can express — three independent blockers, each checked
for real, not assumed. `.changeset/*.md` fails for a shallower reason: real `.md` files (unlike
`scripts/*.ts`), confirmed scannable once added to `roots` (a real CLI dogfood reported the
expected missing-`_SUMMARY.md` warning for its 13 files), but zero real Markdown links exist in
any of them (grep-confirmed), the ADR-style frontmatter-classification idea doesn't transfer
(a changeset's frontmatter key IS the package name, not a fixed field, and "docs-only" is an
absence, which `KindSelector` can't express), and no real GitHub-issue citation exists to ground
a `traces_to`-style rule (the only `github.com` hits are illustrative example strings, same
pattern as the earlier `README.md` finding). What IS a real, evidenced fit for `.changeset/*.md`,
exactly like `README.md` before it: `--prose-refs`, dogfooded both directions for real (a clean
pass, then a constructed citation-rename correctly flagged, then reverted) — not wired into this
repo's own `.cairnrc.json`, matching `checks.freshness`'s own no-real-incident-here reasoning. An
adversarial steelman pass on both conclusions found no reason to overturn either negative
result, only sharpened why each holds (three independent blockers for `scripts/`, not just one;
an open question about generalizing beyond this repo's own two corpora, honestly left unsettled
rather than overclaimed).

**9. Round-10 re-entry with a fresh, context-free reviewer — a genuine fixed point**: a tenth
pass through the full loop, run by a reviewer with no memory of rounds 1-8, re-reads `CONVENTION.md`,
ADR-0005, `review-prompts.md`, and this file cold. Step 1 (clean up): both "current real output"
censuses in `CONVENTION.md` re-run for real and matched exactly (no drift); every
`review-findings.md section N` cross-reference resolves; `cairn check`/`--prose-refs` both ran
clean before this round's reading began — nothing to fix. Step 2 (structure invitation, applied
reflexively to `.cairnrc.json`'s own real coverage block, not another corpus): considered
collapsing the seven `design-package → <role>` "requires" rules into one `{ atLeast: { n: 7,
of: [...] } }` rule now that the shape exists, and rejected it — it would lose the seven
individually-worded per-kind `description` fields ADR-0005's own "Third amendment" deliberately
added; no other rule in the file benefits from `{ any }`, `{ atLeast }`, or `scope: { under }`
either, and `checks.freshness` staying disabled here remains the same reasoned choice section 5
already recorded. Verdict: cairn's own config already uses the minimal, correct shape for its own
needs — every newer capability was individually and correctly left unused, not overlooked. Step 3
(adversarial judge with steelman): steelmanned both "nothing to clean up" and "no config mismatch"
directly; neither steelman held up against concrete evidence (the verification vocabulary's
repetition pairs with real falsifiable claims each time it appears; the `atLeast` collapse would be
a real report-quality regression, not a free simplification). Step 4: nothing concretely scoped to
build — this paragraph, recording a genuine "checked again, still converged," is the round's own
deliverable.
