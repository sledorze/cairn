# Solution space: typed relations (issue #137)

Five candidate directions, evaluated against `problem-space.md`'s constraints and the
spikes in `spikes.md`. (A) is the issue's own full proposal; (B)–(E) are narrower or
orthogonal alternatives found while grounding the design against real code and the accepted
ADR 0004.

## A. The full `(subject, predicate, object, evidence)` vocabulary

Every claim-bearing statement in a doc gets an explicit relation: a closed predicate name,
a typed object (`file:`, `symbol:path#Name`, `set:slug`, `output:producer/aspect`,
`command:`, `grammar:`, `claim:slug`), and mandatory evidence
(`checker "<name>"` | `open` | `declined "<reason>"`). Modality (decidable /
refutable-only / undecidable) is derived from the predicate name, never authored.

**Requires:** a new annotation syntax parsed out of every scanned doc; a closed predicate
registry (extending it is a code change, not a config change — that's the point, per the
issue's own "modality is a function of the predicate" rule); a new sidecar namespace for
relation state; a runner for each decidable predicate cairn implements generically; the
self-refutation and vacuity guards from `problem-space.md`, applied structurally.

**Pros:** the only option that actually subsumes #101 (object can be `symbol:`, not just
`file:`), #130 (object can be `command:`/`output:` with no link at all), and #133 (grouping
by predicate-derived modality is available for free once predicates exist). Directly
matches the evidence base — twelve real checkers in `falsestart` map cleanly onto this
shape (issue's own table).

**Cons:** the largest option here by a wide margin. A closed vocabulary is a real design
liability if wrong — every predicate added later is a schema change, and the issue offers
no syntax as final. The Should-tier decidable runners (`enumerates`/`covers`/`confinedTo`/
`counts`/`parsesAs`) each need their own object-resolution logic per typed-referent kind;
`spikes.md`'s spike 7 builds exactly one (`covers set:`) and that alone required a new
annotation-extraction path, a new object-typed-referent parser, and a new comparison
function — the marginal cost of the next five predicates is unknown, not zero.

## B. Narrow to #130 only — declared extra refs, no predicate vocabulary

A doc front-matter or annotation block declares extra reference targets beyond its real
links (`--refs`'s existing `target`/`hash` shape, just with an object that never needs a
`[text](path)`). `--refs --stamp` hashes them exactly like today's link-derived refs.
**No predicate, no typed referent beyond `file:`/`command:` addressing, no evidence field.**
This is #130's own proposed fix from the issue text, verbatim, minus the reframing.

**Requires:** one new config surface (`checks.refs.extra` or a doc-local annotation naming
extra targets) and one new extraction path feeding the existing `RefStore.ts`/`CheckRefs.ts`
machinery — no new sidecar namespace, no new runner architecture. Spike 7's
`covers set:published-files` predicate is strictly MORE than this option needs; a version
of spike 7 with the comparison logic stripped out (just "hash `package.json`, alert on
change") is this option's walking skeleton, and it is already fully covered by existing
`--refs` code once the target is declared.

**Pros:** cheapest real fix for the one incident with a fully reproduced repro
(`problem-space.md`, spike 7). Ships independently of any ADR 0004 decision — doesn't touch
`--refs` granularity at all, so zero interaction risk with that already-accepted, in-flight
work.

**Cons:** still change detection, not verification — narrower than the issue's stated
target. Doesn't touch #101 (no symbol/set objects) or #133 (nothing about a bare hash-changed
notification is decidable vs. undecidable; every entry still needs a human unless the object
happens to be self-describing).

## C. Vocabulary without generic checkers — declare, validate, gap-report only

Ship the **Must** tier alone: a closed predicate vocabulary, a way to declare a relation at
a claim site (link or not), mandatory evidence, and validation that a declared relation's
predicate is known and its object resolves. No generic decidable-relation runner ships — an
`evidence: checker "<name>"` relation is trusted at face value (does the named checker
exist and pass, exactly like today's hand-written `documented.test.ts` checkers, just now
DECLARED where the claim is made instead of living only in a separate test file). Gap
reporting (a relation with `evidence: open`) becomes a visible list.

**Requires:** everything in (A) except the Should-tier runners for
`enumerates`/`covers`/`confinedTo`/`counts`/`parsesAs`.

**Pros:** materially smaller than (A) — the annotation syntax, predicate registry, and both
hazard guards (self-refutation, vacuity) are the load-bearing, hard-to-get-wrong parts;
generic runners are comparatively mechanical once those exist, and can ship incrementally
per `roadmap.md`. Makes the invisible visible immediately: `open`/`declined` relations
become a real, queryable list — this alone, per the issue, is "what makes #130
expressible."

**Cons:** doesn't yet let cairn CATCH anything new by itself — a declared `covers
set:published-files` relation with `evidence: open` is honest but not enforced, so the
concrete #130-shaped incident this package's walking skeleton reproduces still wouldn't be
caught until a later increment ships the runner.

## D. Frontmatter-anchored relations instead of an inline comment/fence syntax

Anchor a doc's relations in its YAML frontmatter block (`---\n...\n---`) rather than an
inline `<!-- relation: ... -->` comment or a fenced fence-block. `DocMetadata.ts` already
parses frontmatter for `checks.coverage` kind selection, so this reuses an existing,
audited extraction path rather than adding a new masking primitive.

**Requires — and this is the real finding, not assumed:** `parseFrontmatter` is a flat
`key: value` reader by explicit design ("not a general YAML parser... no nesting, no
lists"). A relation needs at minimum three fields, one of them (`object`) itself structured
— that does not fit today's reader. This option's true cost is extending `parseFrontmatter`
into something closer to a real (if still narrow) YAML subset, which is a bigger, riskier
change to an existing, currently-simple, security-relevant parser than adding a new fenced
block ever is (spike 5).

**Pros:** genuinely immune to the self-refutation hazard's masking half — frontmatter is
never rendered as prose a reader (or a naive checker) sees, so there's no "does the checker
read through a stripping helper" question to get wrong. Also naturally scoped to one claim
per doc-region only awkwardly (frontmatter is a single block at the top of the file, not
positioned at the specific claim site a relation is about) — a real cost against the
issue's own "subject — a document REGION" requirement.

**Cons:** the positioning mismatch above is serious: eight of the issue's twelve real
`falsestart` examples are claims made about a SPECIFIC sentence or table, not the document
as a whole. A single top-of-file frontmatter block can't express "this specific paragraph
claims X" without inventing a second addressing scheme (line ranges, heading anchors) layered
on top — which reintroduces most of the complexity this option was chosen to avoid.
**Rejected as the primary mechanism**, but frontmatter remains attractive for
document-level (not claim-site-level) relations specifically — see `roadmap.md`.

## E. Do nothing — let ADR 0004 and output grouping handle #101/#133 separately

Ship no typed-relation mechanism. #101 stays on ADR 0004's already-accepted 3-release path
(narrower `--refs` hashing units, culminating in symbol-scoped citations). #133 becomes a
narrow, standalone fix: label `--refs` output by whether the changed target is itself a doc
(likely just re-stamped) or real source (needs review) — no predicate vocabulary required,
using the doc-vs-source classification `checks.summaries` already computes internally.
#130 stays open, or gets fixed narrowly by option (B).

**Pros:** zero new mechanism, zero new hazard surface, zero risk of conflicting with
ADR 0004's already-in-motion work. `--refs` is still explicitly labeled experimental and
not enabled in this repo's own config — the bar for adding a second parallel citation
mechanism (constraint 5, carried over from `101-refs-symbol-scoping/problem-space.md`)
applies with even more force to a THIRD, larger one.

**Cons:** #133's proposed fix (doc-vs-source labeling) is real but strictly weaker than what
typed relations would give: it distinguishes WHO should look at a diff, never whether the
diff matters. #130 stays unfixed by ADR 0004's own scope (that ADR is entirely about
`--refs`'s existing link-shaped citations, not about claims with no link at all) — this
option only closes #130 if (B) is ALSO built as a companion, which then makes "do nothing"
a partial answer, not a full one.

## Relationship to ADR 0004 — must be stated explicitly, not left implicit

ADR 0004's Release 3 (symbol-scoped `#name` citations, gated on real evidence that Release
2's export-surface granularity is still too coarse) and option (A)'s `symbol:path#Name`
typed object describe **the same underlying mechanism** — a citation narrowed to one named
declaration, located via `typescript/unstable/ast`'s scanner (`101-refs-symbol-scoping/spikes.md`
spike 4, reusable as-is here). Under option (A) or (C), #137 does not compete with ADR 0004;
it **absorbs Release 3** as one instance of `symbol:` object resolution inside a more
general typed-object model, and Releases 1–2 (per-glob scope, export-surface hashing)
remain exactly as accepted — they are about `file:`-typed objects' hash GRANULARITY, a
question typed relations doesn't need to re-answer, only to let a `symbol:`-object claim
opt into once it's built. Under option (E), ADR 0004 is untouched and unaffected, which is
also a legitimate reading of "do nothing" — it does not require reopening that ADR.

## Synthesis — the roadmap's actual recommendation (detailed in `roadmap.md`)

**(C) ships first: vocabulary, declaration, validation, mandatory evidence, gap reporting —
no generic runners.** This is the smallest slice that makes #130 EXPRESSIBLE (the issue's
own stated bar for the Must tier) and is honest about what it does and doesn't catch
mechanically. **(B)'s `--refs`-extra-target mechanism ships alongside it, reusing rather
than duplicating (C)'s object-addressing work**, so the one fully-reproduced incident this
package has ([spike 7](./spikes.md)) is actually CAUGHT, not just declared. **Generic decidable runners
(the rest of (A)'s Should tier) ship incrementally after, one predicate at a time, each
gated on a real `evidence: open` relation in this repo's own docs that a runner would close**
— the same "ship the smallest real slice, prove it, then the next" discipline
`101-refs-symbol-scoping/roadmap.md` already uses. **(D) is rejected as the primary
mechanism** but revisited for doc-level (not claim-site) relations if a real case surfaces.
**(E) is the fallback if the ROI attack this package explicitly defers (see
`problem-space.md`'s evidence-basis section) comes back negative** — every increment below
is independently abandonable at that checkpoint without leaving ADR 0004 or #133 worse off
than before this package existed.
