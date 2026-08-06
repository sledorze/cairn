# Spikes: feasibility evidence for issue #137 (grounded, not assumed)

Every claim below was run against this repo's actual `src/`, not asserted from the issue's
own text — the issue verified its constraints against cairn 0.9.0's published `dist`; two
of its four claims did not hold unchanged against current source (spikes 2 and 6). Scratch
code lives in `.scratch/137-typed-relations/` (not committed — precedent:
`.scratch/structure-poc/`), run with `npx tsx`.

## Spike 1 — is a link inside an HTML comment actually live?

**Question:** does `stripCode`/`extractLinks` treat `<!-- [t](../src/x.ts) -->` as a real,
existence-checked, `--refs`-hashed link, as the issue claims?

**Method:** ran `stripCode` and `extractLinks` directly against a fixture doc containing
exactly that comment (`s1-s3-masking.ts`).

**Result: confirmed.** `stripCode`'s output for the comment region is byte-identical to the
input — `maskFencedCode` only masks fenced code blocks, and `INLINE_CODE_RE` only masks
backtick spans; neither touches `<!-- -->`. `extractLinks` returns the link from both the
raw and the stripped content: `{ target: '../src/checking/engine.ts', text: 't' }`. Any
annotation syntax that embeds `[text](path)`-shaped text inside a comment is a real,
tracked link today, not inert.

## Spike 2 — does `--prose-refs` really see nothing inside an HTML comment?

**Question:** the issue's stated mechanism is `NON_PATH_CHARS_RE` rejecting `<`/`>`. Does
that actually make every candidate inside a comment invisible?

**Method:** ran `extractProseRefs` against two fixtures — a bare path in a comment
(`<!-- src/checking/engine.ts -->`, no backticks) and a backticked path in a comment
(``<!-- `src/checking/engine.ts` -->``).

**Result: partially falsified — more precise than the issue states.** The bare-path
fixture returns `[]` (confirmed invisible, as claimed). The **backticked** fixture returns
`[{ text: 'src/checking/engine.ts' }]` — `extractProseRefs`'s candidate extraction
(`INLINE_CODE_CAPTURE_RE`) is scoped to backtick spans wherever they occur in the raw
document text, comment or not; `NON_PATH_CHARS_RE` only rejects `<`/`>` when they appear
_inside_ the candidate itself. A backtick-quoted address inside a comment gets accidental
partial existence-checking today. This changes `implementation-details.md`'s annotation
syntax choice: a design that assumes comments are fully inert to every existing check would
be wrong.

## Spike 3 — the `#` asymmetry: mechanism, not just outcome

**Question:** confirm the issue's claim that a backticked symbol anchor in prose is
reported broken while the same fragment in a link is tolerated, and find the exact code
path responsible.

**Method:** ran `extractProseRefs`/`looksLikeRootedPath` against
`` `src/checking/engine.ts#checkFile` `` in prose, and `extractLinks` against the
equivalent `[checkFile](../src/checking/engine.ts#checkFile)` link form. Then read
`CheckProseRefs.ts`'s `resolveOne` directly for the mechanism.

**Result: confirmed, mechanism located.** `extractProseRefs` captures the fragment whole
(`{ text: 'src/checking/engine.ts#checkFile' }`); `looksLikeRootedPath` accepts it (`#` is
not in `NON_PATH_CHARS_RE`). `CheckProseRefs.ts`'s `resolveOne` then does
`path.join(base, text)` on the **raw** candidate — no call to `stripAnchor`/`parseTarget`
anywhere in that file — so the anchor is joined as a literal path segment
(`engine.ts#checkFile`, which does not exist on disk) and reported `missing`.
`CheckLinks.ts`, by contrast, already goes through `parseTarget`/`stripAnchor`
(confirmed by `101-refs-symbol-scoping/spikes.md` spike 1, unchanged here) and treats a
non-line, non-heading fragment after `#` as a symbol anchor. The asymmetry is exactly:
one file calls the anchor-aware split, the other doesn't — a small, mechanical gap, not a
structural one.

## Spike 4 — the self-refutation hazard, both directions, run for real

**Question:** does quoting a proposition at its own claim site actually flip a
`neverClaims`-shaped check, and does naming an object inline actually satisfy a
`covers`-shaped check — as the issue's hazard section claims, but doesn't demonstrate in
code?

**Method:** wrote literal predicate functions (`neverClaims`, `coversAllMembers`) in the
same shape a typed-relation checker would take, and ran each against a "naive" doc (the
annotation quotes its own proposition/object inline) and a "fixed" doc (references by slug,
evaluated through a `stripAnnotations` helper) — `s4-self-refutation.ts`.

**Result: confirmed, both directions, with real output.**

- `neverClaims(docNaive, forbidden)` → `false` — the annotation's own quoted text makes the
  doc "contain" the forbidden sentence, flipping a true claim to reported-false.
  `neverClaims(stripAnnotations(docBySlug), forbidden)` → `true` once the annotation
  references the proposition by slug and the checker strips annotations before reading.
- `coversAllMembers(docSelfSatisfying, members)` on raw text → `true`, even though the
  doc's real prose never actually enumerates the three members — the annotation's own
  object list supplies them. This is the more dangerous direction: it fails **green**.
  `coversAllMembers(stripAnnotations(docSelfSatisfying), members)` → `false`, correctly,
  once the annotation is stripped first.

A first draft of this fixture accidentally repeated the forbidden members in the
surrounding PROSE too ("this doc does not enumerate alpha, beta, or gamma") — which made
the stripped check pass by accident regardless of the fix, for the wrong reason. Caught by
actually reading the printed output rather than assuming the intended fixture matched what
was written; corrected to prose that names the concept without repeating the member tokens.
Recorded because it is itself a small instance of `knowledge.md`'s "verify by re-running,
not by re-reading intent" discipline.

## Spike 5 — is a frontmatter block a viable relation anchor, cost-wise?

**Question:** `DocMetadata.ts` already parses YAML frontmatter for `checks.coverage` kind
selection — can a relation declaration reuse that reader as-is?

**Method:** read `parseFrontmatter`'s implementation and its own header comment directly;
no code needed to run — the shape is stated explicitly in the source.

**Result: confirmed cost, not free.** `parseFrontmatter`'s own comment: "a minimal,
intentionally narrow YAML-frontmatter reader — not a general YAML parser... no nesting, no
lists, no multi-line scalars." Its regex (`FRONTMATTER_LINE_RE`) only matches flat
`key: value` lines. A relation needs `predicate` + a **structured** `object` (a typed
referent, e.g. `set:published-files [dist, schema, CHANGELOG.md]`) + `evidence` — at
minimum one field beyond flat scalars. Reusing `parseFrontmatter` unchanged is not viable;
extending it into a richer (if still narrow) reader is a real, non-zero cost against an
existing, currently simple and audited parser — `solution-space.md` option D's stated cost.

## Spike 6 — does Prettier really insert a blank line before an own-line comment abutting a table?

**Question:** re-verify the issue's stated Prettier hazard against this repo's real
toolchain and config.

**Method:** wrote a Markdown fixture with a table immediately followed by an own-line
`<!-- ... -->` (both a `relation:`-shaped comment and a plain one), ran
`npx prettier --write` against this repo's real `.prettierrc` (`printWidth: 120`, no
`proseWrap` override) with the installed `prettier@3.9.6`, then ran it a second time and
diffed the two outputs.

**Result: falsified, under this repo's real config/version.** No blank line was inserted
either time; the two passes produced byte-identical output (idempotent). This may be
version- or `proseWrap`-setting-sensitive, or the original observation may have been made
under different conditions — either way, "Prettier reformats a relation annotation
unpredictably" is **not a confirmed constraint** for this repo and should not be treated as
load-bearing in `implementation-details.md` without a fresh, dated repro if it resurfaces.

## Spike 7 — walking skeleton: `covers set:published-files`, red then green, on the real #130 shape

**Question:** can one decidable predicate be built far enough, end to end, to catch the
actual #130 incident shape (a doc's declared set of published paths vs. `package.json#files`,
addressed with no link) — and does it actually go red on real drift and green after a fix?

**Method:** using `makeTempProject` (this repo's own integration-test helper, not invented
scaffolding), wrote a minimal `covers set:published-files` implementation: a
` ```cairn-relation ... ``` ` fenced block (masked from prose by the EXISTING
`maskFencedCode` — no new masking primitive needed for the annotation itself), a narrow
parser for `covers set:published-files [a, b, c]`, and a comparison against
`package.json#files`. Ran three states: doc and `package.json` agreeing; `package.json`
gaining an entry the doc was never updated for (the actual #130 shape); the doc fixed to
match — `s7-walking-skeleton.ts`.

**Result: confirmed, exactly as intended.**

- BEFORE (agreeing): `{ ok: true, detail: 'matches' }`.
- AFTER (`package.json#files` gains `CHANGELOG.md`, doc unchanged — the #130 incident):
  `{ ok: false, detail: 'missingFromDoc=[CHANGELOG.md] extraInDoc=[]' }`. This is the exact
  drift today's `cairn check` cannot see, per `problem-space.md` — caught here.
- After fixing the doc: `{ ok: true, detail: 'matches' }`.

This is the Must-tier claim declaration (`option C`) plus one Should-tier decidable runner
(`option A`'s `covers`), built together — confirming `solution-space.md`'s synthesis that
pairing them is what actually closes the one fully-reproduced incident, not (C) alone.

## Spike 8 — the vacuity guard: reproduced, and refined past the issue's own framing

**Question:** does a naive set-comparison checker really pass silently on a renamed/missing
heading, as the issue attributes to `falsestart/documented.test.ts:294-312`?

**Method:** built a minimal `itemsUnderHeading` extractor and two comparison shapes — a
full set-equality check (size + membership) and a subset-only check (membership only, no
size check) — against a doc before and after its heading is renamed —
`s8-non-vacuity.ts`.

**Result: confirmed, with a more precise boundary than the issue states.** The full
equality comparison (`enumeratesNaive`) is NOT actually vulnerable — `found.size !==
want.size` already returns `false` correctly once the heading is renamed and `found` comes
back empty. The real trap is specifically a **subset-only** comparison
(`enumeratesVacuous`, `found.every(f => want.has(f))` with no separate size check):
`[].every(...)` is vacuously `true` in JavaScript regardless of the predicate, so a renamed
heading passes silently. A guard that explicitly checks `found.size === 0 && want.size > 0`
before evaluating, returning a named failure rather than a boolean, catches it. This means
`implementation-details.md`'s generic decidable runners must apply the guard to every
comparison shape they implement, not assume full-equality comparisons are automatically
safe — but it also means the actual engineering cost is smaller than "every set comparison
needs defending," since some shapes already defend themselves structurally.

## What these spikes change about `solution-space.md`'s ranking

- Two of the issue's four stated masking/asymmetry constraints held exactly (spikes 1, 3);
  one held only partially, in a way that changes annotation-syntax risk (spike 2: backticked
  comments are NOT fully inert); one did not reproduce at all under this repo's real
  toolchain (spike 6) and should not be treated as settled.
- Spike 5 turns option D (frontmatter-anchored relations) from "reuses an existing parser
  for free" into "requires extending an intentionally narrow, currently-simple parser" — a
  real cost that, combined with option D's positioning mismatch (`solution-space.md`), is
  why it's rejected as the primary mechanism.
- Spike 7 is the single most load-bearing result: it proves the Must tier (declare) plus
  one Should-tier runner (`covers`) is buildable **today**, with existing infrastructure
  (`maskFencedCode`, `makeTempProject`), and that it catches the one incident this whole
  package traces back to. Without this spike, `roadmap.md`'s first release would be
  speculative; with it, it's demonstrated.
- Spike 8 narrows the vacuity-guard requirement from "every comparison" to "every
  subset-only comparison" — smaller, more precisely scoped engineering work for
  `implementation-details.md` than the issue's own framing implies.
