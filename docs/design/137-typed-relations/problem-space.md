# Problem space: typed relations (issue #137)

Full design package for closing [issue #137](https://github.com/sledorze/cairn/issues/137)
("Typed relations: a link records an address, not an assertion — so cairn can only say 'it
changed'").

## The mechanism as it exists today

Every check cairn ships today answers one of two questions: "does this address resolve"
(`checks.links`, `--prose-refs`) or "has what this address points to changed since it was
recorded" (`--refs`, and by extension `checks.freshness` for the doc itself). Both are
**change detection**. Neither can say whether the doc's actual sentence is still true —
only whether the byte range it points at, or the doc itself, is the same as it was when
last stamped.

Concretely: a link records `{ target, text }`
([`MarkdownLinks.ts`](../../../src/core/links/MarkdownLinks.ts)); `--refs` adds
`{ target, hash, anchor? }` ([`RefStore.ts`](../../../src/core/links/RefStore.ts)). Neither
carries what the surrounding prose actually **claims** about the target — that the target
enumerates a set, that it never does something, that its output matches a fixture. There is
no field anywhere in cairn's data model for a claim's truth condition, only for its address
and its hash.

## The failure mode, observed for real (three angles on one root cause)

**#101 — whole-file granularity.** Dogfooding `--refs` on `sledorze/falsestart`:
`docs/architecture.md` cited 14 implementation files; editing any line of any of them
failed `cairn check`, including edits the doc's own claim never depended on. Reflexive
re-stamping followed — "a gate you clear without reading," per that issue's own framing.
[ADR 0004](../../adr/0004-refs-scoped-hashing-granularity.md) already accepts a 3-release
fix for this specific symptom (narrower hashing units). #137's re-framing: the doc's
citation names a _file_, when what it actually claims is about a _symbol_ or a _set_ — a
typed object would let the citation say which, directly, rather than inferring granularity
from config.

**#130 — a claim about a non-linked file drifts silently.** In a later session on this
same repo, `README.summary.md` stated the published tarball ships six named paths.
Adding `CHANGELOG.md` to `package.json#files` (PR #135, closing #134) made that sentence
false. `cairn check` stayed green the entire PR: the sentence named no path at all, so
nothing hashed it, and nothing could. The author caught it by eye. `README.summary.md` no
longer states that sentence today (this repo's own README has since been restructured), so
the exact artifact isn't reproducible verbatim — the walking-skeleton spike below
reconstructs the same shape faithfully instead of literally replaying a file that no longer
exists ([`spikes.md`](./spikes.md), spike 7).

**#133 — source-drift and doc-drift arrive undifferentiated.** In the same session, one
`--refs` run reported six "a doc you link to had its prose re-stamped" entries alongside
one "a real source file changed" entry, in one undifferentiated list. The one entry that
needed a human read was six lines of noise away from it.

The common shape: each symptom is a different consequence of the same missing field. #101
is "the address is too coarse for what's actually claimed." #130 is "there is no address at
all for what's claimed." #133 is "there's no way to ask the report itself which entries are
mechanically self-checking and which need a human," because nothing about a link says
whether what it stands for is decidable by machine.

## Evidence basis — stated plainly, not overstated

Like [#101's own problem-space](../101-refs-symbol-scoping/problem-space.md), this design
rests on **one maintainer's own dogfooding**, across two side projects
(`sledorze/falsestart`, this repo), not on independent corroboration — #137, #130, and #133
have zero comments and zero reactions from anyone else as of this writing. That doesn't
make the reports wrong; each is a concrete repro with code cited, not a vague complaint. But
it bounds how much investment is honestly justifiable off this alone — see
`solution-space.md`'s "do nothing" / narrow-scope options, and the recurrence-gate
discussion below.

**What's different from a first report, and is the actual reason this design package
exists rather than being deferred again:** this exact territory was designed once already
and killed. `AGENTS.md`'s "Shipping one iteration well" section records a `checks.claims`
episode — two turns of design spent before an ROI attack (run against the _now-concrete_
design) reversed the pick, with nothing committed: no schema, no vocabulary, no
rejected-options record survives. The lesson drawn from that was explicit: _run a cheap
recurrence gate first; save the full ROI attack for after a concrete design exists._ Traced
by provenance (`git log -S "checks.claims"` finds it only in that one AGENTS.md addition,
added in the same PR — #135 — that fixed #130's own incident): `checks.claims` was almost
certainly the design killed _for_ #130's incident. #137 reopens the same territory three
days later, citing **twelve independently-added, hand-written checkers** in
`falsestart/src/documented.test.ts` (850 lines, 26 tests), each added after a real bug
shipped with `cairn check` green — a materially larger evidence base than "one incident,"
even though it is still all self-reported by the same person. That clears the recurrence
gate (this is not the first time the shape has cost real debugging time); it does not by
itself clear an ROI bar, which is why this package's job is to produce a concrete design an
ROI attack can be run against as a _separate_ follow-up, not to presuppose the answer.

## Root cause, precisely stated

A link (or a `--refs` record) is a **relation with an implicit, unstated predicate**: "this
doc's prose somewhere near here is about that target," with the _specific_ claim left to a
human reader to infer from context. Because the predicate is implicit, cairn can only ever
measure whether the _target_ changed — it has no way to evaluate whether the _specific
claim_ the prose actually makes about that target is now true or false. Making the
predicate explicit is what turns "it changed" into something that can be right or wrong.

## Constraints on any solution — verified against current `src/`, not assumed

Re-verified for this package against this repo's real `src/` (the issue's own constraints
were checked against cairn 0.9.0's published `dist`); see `spikes.md` for the run evidence.
Two of the issue's four claims held; two did not, or held only partially — recorded here
exactly as found, not smoothed over:

1. **Confirmed — `stripCode` does not mask HTML comments.** A `[text](path)` written
   inside `<!-- ... -->` is treated as a live link: existence-checked by `checkLinks`,
   hashed by `--refs`. Any annotation syntax that itself contains `[...]( ... )`-shaped
   text is not inert if placed inside a comment (spike 1).
2. **Partially falsified — `--prose-refs` DOES see inside an HTML comment, for a
   backticked candidate.** The issue's stated mechanism (`NON_PATH_CHARS_RE` rejects `<`/
   `>`) is real, but it only matters if the candidate text _itself_ contains those
   characters. `extractProseRefs`'s candidate extraction is scoped to backtick spans
   (`` `...` ``) wherever they occur — including inside a comment — so ``<!-- `src/x.ts` -->``
   _is_ extracted and existence-checked today. Only a _bare_, non-backticked path inside a
   comment is invisible. This matters directly for annotation design: a backtick-quoted
   object address inside a comment gets accidental partial drift protection nobody asked
   for and nobody has audited (spike 2).
3. **Confirmed — the `#` asymmetry is real, and its mechanism is precise.**
   `` `src/x.ts#Sym` `` in prose is captured by `extractProseRefs`
   (`looksLikeRootedPath` doesn't reject `#`) and then joined onto `base` **literally,
   anchor included** by `CheckProseRefs.ts`'s `resolveOne` (no `stripAnchor`/`parseTarget`
   call) — so it is reported broken as a nonexistent path. The identical fragment inside a
   real link (`[t](../src/x.ts#Sym)`) IS anchor-aware, via `parseTarget`/`stripAnchor`
   (used by `CheckLinks.ts`) — spike 1 of `101-refs-symbol-scoping/spikes.md` already
   established the `#`-split itself is free. The asymmetry is specifically that
   `CheckProseRefs.ts` never calls into that existing split (spike 3).
4. **Falsified — no blank-line insertion reproduced.** The issue reported Prettier
   inserting a blank line before an own-line `<!-- ... -->` abutting a table row. Run
   twice, byte-for-byte, against this repo's actual `prettier@3.9.6` and its actual
   `.prettierrc` (`printWidth: 120`, no `proseWrap` override): no blank line was inserted,
   and the output was idempotent across both runs. Either this was fixed upstream, is
   version/config-sensitive, or was itself an error in the original observation — treat
   "Prettier reformats a relation comment unpredictably" as **unconfirmed** going into
   `solution-space.md`, not as a load-bearing constraint (spike 6).

**New constraint, found in this package's own spikes, not in the issue:**
`parseFrontmatter` (`DocMetadata.ts`) is a genuinely flat `key: value` reader — no lists, no
nesting, "not a general YAML parser" by its own header comment. A relation declaration needs
at minimum a predicate, a typed object, and evidence — three fields, one of which
(`object`) is itself structured (a typed referent) — which does not fit today's frontmatter
reader without extending it into something closer to a real (if still narrow) YAML subset.
This is a real, previously unstated cost for any frontmatter-anchored design (spike 5).

## The self-refutation hazard — reproduced, not just narrated

The issue names a hazard: a relation about a document's own text can be satisfied, or
falsified, by the act of writing the annotation that labels it. Spike 4 constructs both
directions with real code, not hypothetically:

- **A `neverClaims`-shaped check, quoting its own forbidden text at the claim site, flips
  itself false** — `neverClaims(docText, forbidden)` correctly returns `false` once the
  annotation contains the literal forbidden string, even though the doc's real prose never
  asserts it.
- **A `covers`-shaped check, naming its own object inline, silently satisfies itself** —
  `coversAllMembers(docText, members)` returns `true` reading raw text (the annotation's own
  object list supplies the missing members), and correctly returns `false` once the checker
  reads through an annotation-stripping helper first. This second case is the more
  dangerous one: it fails **green**, not red — a reader has to already suspect a problem to
  go looking for it.

Both are closed by the same two disciplines, confirmed to work by the same spike: reference
a proposition by **slug**, never inline its text; and have exactly **one**
annotation-stripping helper every checker reads documents through, so no checker can ever
see its own annotations.

## The vacuity guard — reproduced, refined

Spike 8 reconstructs the class of failure the issue attributes to
`falsestart/documented.test.ts:294-312` (a renamed heading silently comparing two empty
sets). Running it found a more precise boundary than the issue states: a **full
set-equality** comparison (`found.size === want.size && ...`) already fails correctly on an
empty `found` set, because the size check alone catches it. The actual trap is a
**subset-only** comparison (`found.every(f => want.has(f))`, with no separate size check) —
`[].every(...)` is vacuously `true` in JavaScript regardless of language, and an empty
`found` set (a renamed/missing heading) passes silently. The fix is a guard that explicitly
rejects `found.size === 0 && want.size > 0` before evaluating the predicate, returning a
named failure rather than a boolean. Any generic decidable-relation runner (`solution-space.md`'s
Should tier) must apply this guard structurally — not leave it to each hand-written checker
to remember, the way `falsestart`'s own test file evidently didn't.

Every constraint and hazard above rests on real code actually run, not narrated — see
[`spikes.md`](./spikes.md) for the full method and output of each.
