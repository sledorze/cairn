# Solution space: narrowing what `--refs` hashes (issue #101)

Five candidate directions, evaluated against `problem-space.md`'s constraints. The issue
itself names two (A, B); this pass adds three more found while grounding the design in the
actual code (`RefStore.ts`/`CheckRefs.ts`), then a synthesis.

`checkFile`/`../src/checking/engine.ts` below is the ILLUSTRATIVE example from the
reporter's own external repo (`sledorze/falsestart`, quoted in `problem-space.md`) —
neither that path nor that symbol exists anywhere in cairn's own `src/`. `spikes.md`
deliberately switches to a REAL cairn file (`core/structure/DocCoverage.ts`) once a claim
needs to be verified against actual code, and says so explicitly there.

## A. Symbol-scoped references — hash only the cited symbol's declaration

A doc cites `[checkFile](../src/checking/engine.ts#checkFile)`. `RefRecord.anchor` already
carries `"checkFile"` (`RefStore.ts:39` — the field exists, unused for this purpose today).
`stampRefs` locates the exported declaration named `checkFile` in `engine.ts` and hashes
**only its source text** (signature + body, not the whole file); `checkRefs` re-locates and
re-hashes the same declaration.

**Requires:** a real parser for the target language, to find a named declaration's byte
range reliably. Regex-based extraction ("find `export const checkFile` and its matching
brace") is fragile in the same spirit `core/links/markdownFences.ts`'s own comment
describes for its (different) masking problem — that file's actual words are "a provably
linear line scan, not a single regex," chosen because ITS shape (finding fence boundaries)
is simple enough for a linear scan to be provably correct. Locating an arbitrary
declaration's balanced-brace end across template literals, nested functions, and
brace-like characters inside comments/strings is a meaningfully HARDER shape than fence
masking — not provably safe with a comparable linear scan, which is why this option
requires a real parser rather than reusing that file's technique. (Spike 4 in
`spikes.md` confirms a real, low-cost, standalone parser primitive exists for this.)

**Pros:** most PRECISE — a change to an unrelated symbol in the same file never counts;
lets a doc cite a specific, narrow claim. Directly matches the issue's own second
suggestion.

**Cons:** heaviest new dependency (a language-aware parser, at minimum for TypeScript/
JavaScript — the languages this repo's own source is written in and the most likely first
target). A citation to a symbol that gets renamed silently stops resolving (same class of
problem `CheckLinks.ts`'s anchor-fix already solves for Markdown headings — an anchor
resolution/fix story would need to exist here too, or every rename becomes a broken
citation with no repair path).

## B. API-surface hashing — hash a file's exported declarations, not its bytes

Hash the set of a file's **exported** declarations rather than its full content. An
internal-only change (a private helper's body, a local variable rename) never changes the
hash; an exported declaration's ADDITION or REMOVAL always does.

**Open question this option does NOT settle** (resolved neither here nor by this design —
see `implementation-details.md`'s own explicit "not decided speculatively" section and
`docs/adr/0004`'s "Explicitly NOT decided" list): whether the hash covers just the exported
SIGNATURE (name + type, no body) or the WHOLE exported declaration including its body.
Signature-only is the narrower, more-precise-sounding framing and is what first comes to
mind reading the issue's own suggestion — but it would MISS "the exported function's
behavior changed while its type signature didn't," which `problem-space.md`'s constraint 1
(never hide real, relevant drift) would flag as a real gap. Whole-declaration is closer to
Release 1's `whole-file` granularity, just narrowed to one declaration, and doesn't have
that gap. This genuinely needs real evidence from actual false-positive/false-negative
cases before deciding, not a choice made speculatively in this document.

**Requires:** the same real-parser dependency as (A), but a meaningfully cheaper walk —
finding every top-level `export`-keyword-prefixed declaration in one pass (spike 4 in
`spikes.md`), never needing to resolve which ONE specific symbol a particular citation
names the way (A) does. Whether that walk stops at each declaration's signature or
continues through its full body (the open question above) doesn't change this shape —
either way it's one linear pass locating declaration boundaries, not per-citation symbol
resolution.

**Pros:** solves the reporter's own worked example EXACTLY as they independently converged
on with their facade restructure — "does this area's public surface change" is precisely
what the facade's `index.ts` re-export list makes citable, and API-surface hashing makes
that computable **without** requiring the restructure. Directly matches the issue's own
first suggestion, and requires no new citation SYNTAX (`[text](path)`, no `#anchor` needed)
— existing whole-file citations upgrade in place.

**Cons:** still per-language (needs to know what "exported declaration" means in each
target language — TypeScript's `export`, Python's absence of one, Go's capitalization
convention). Coarser than (A): an unrelated exported symbol's signature change in the same
file still counts as drift for a citation that only cares about one specific export.

## C. Git-history-based heuristic — no parser, approximate via diff hunks

Instead of parsing the target's structure at all, use `git blame`/`git diff` to check
whether the lines that changed since the last stamp fall within a heuristically-detected
"declaration region" (e.g. from the citation's anchor line to the next top-level statement
at the same indent, found by a simple brace/indent scan, not a real parser).

**Pros:** no new language-specific dependency; reuses `io/Git.ts`'s already-established
real-`git`-shellout pattern (`GitFsLive`, `ChildProcessSpawner`) rather than adding a new
IO capability.

**Cons:** an indent/brace heuristic is exactly the "backtracking-prone, fragile" class this
repo's own conventions explicitly steer away from (see `markdownFences.ts`'s comment,
cited in (A)) — and unlike that file's LINEAR scan (safe because it only needs to detect
fence boundaries, a much simpler shape), a heuristic declaration-boundary detector has to
get function/class/block boundaries right across many languages, which is a much larger
false-negative surface. Violates constraint 1 (never hide real drift) more easily than any
other option here — an indent-based heuristic WILL sometimes think a change is
"inside" a declaration boundary when it 1) isn't, or 2) miss a change that widens a
declaration across a line the heuristic didn't expect. Not pursued further; recorded here
because it's the "no dependency at all" alternative and its rejection reasoning is itself
useful to have on record for a future reader who proposes it again.

## D. Per-target hash-scope config, no auto-detection

Let config declare, per glob, how much of a matched file counts: `"refs": { "scope": [{
"glob": "src/**/index.ts", "unit": "whole-file" }, { "glob": "src/**/!(index).ts", "unit":
"exports-only" }] }` — reusing this repo's own `sources`/`coveredBy`-style named-glob-group
convention (`checks.docCoverage`, `core/Config.ts`'s `DocCoverageGroupInputSchema`) rather
than inventing a new config shape.

**Pros:** ships INDEPENDENTLY of (A)/(B) — even "whole-file vs. nothing" (an `"ignore"`
unit, effectively opting a glob out of `--refs` entirely) already solves the reporter's
immediate pain with zero new parsing: exempt `src/checking/*.ts` (the leaves) from
`--refs`'s scan, keep hashing `checking/index.ts` (the facade) whole. Composes with (A)/(B)
as later `unit` values, not a competing design.

**Cons:** on its own (without A/B), doesn't add PRECISION — it only lets a user manually
draw the same boundary the reporter drew by hand, via config instead of a file move. Still
requires the same facade-shaped codebase to be worth doing. Doesn't remove the core
mechanism gap (A)/(B) each independently close.

## E. Do nothing — leave `--refs` v1/whole-file, document the limitation loudly

`--help` already says `v1/whole-file` (per the issue's own observation) — the limitation is
disclosed, not hidden. Argument for: `--refs` is opt-in and still labeled experimental in
the README; a user who hits this can simply not enable `--refs` for a doc citing many
leaves, same as the reporter could have chosen "stop citing source" instead of restructuring.

**Rejected as a durable answer, not as a v1 stopgap:** the whole point of `--refs`
existing is to make citing real implementation code from docs trustworthy over time — the
same motivating value `checks.docCoverage` (issue #108) was just built around. If the
mechanism actively punishes wide, granular citation (as observed), it works AGAINST the
adjacent feature's own goal the moment both are enabled in the same repo. "Document the
limitation" is a fine INTERIM stance (arguably the current one) but not a design decision.

## Synthesis — the roadmap's actual recommendation (detailed in `roadmap.md`)

**(D) whole-file/exempt scoping ships first** — zero new dependencies, directly and fully
resolves the reporter's reported pain (exempt the leaves, keep the facade), reuses an
existing config idiom. **(B) API-surface hashing ships second** — solves the general case
(no facade restructure required) with the shallower, lower-risk parse of the two "real
parser" options. **(A) symbol-scoped citations ship third, if ever** — highest precision,
highest cost (parser + anchor-rename resilience story), and only clearly justified once
real usage of (B) surfaces cases where whole-export-surface granularity is still too coarse
(e.g. one enormous exported object with many independent fields). **(C) is not pursued.**
