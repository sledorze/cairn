# ADR 0005 — design packages via checks.coverage — summary

Working on #101's own design package surfaced a real question: hand-authored Markdown files
with no consistent heading schema and no config representation — nothing enforced a design
package having all its required pieces.

**Original decision:** no new config primitive — `checks.coverage`'s existing `kinds`/
`rules` mechanism expresses "every design-package `_SUMMARY.md` must link to a doc of each
required role." Accepted "not scoped per-package" as a documented limitation.

**Amendment: that gap needed closing for real.** A throwaway hollow package cross-linking a
real sibling's docs passed cleanly, zero warnings — severe, not theoretical. A first fix
(per-package hand-scoped kind ids, no core change) closed it but reopened the ORIGINAL
problem: accidental incompleteness in any unconfigured package went silently uncaught, and
`.cairnrc.json` grew without bound per package. The real fix needed the core change this ADR
originally avoided: `scope: "sibling"` on `CoverageRule` (`core/Config.ts`, `core/structure/
Coverage.ts`) — satisfied only by a same-directory `to`-kind doc. One generic, wildcard-glob
block now closes both gaps at once, for every package present and future, zero per-package
config ever again.

Also caught, on first write: adding `scope` without adding it to `checkCoverage`'s rule-
dedup key would have silently collapsed two same-pair rules — the FOURTH occurrence of this
exact bug class, caught this time by the key's own standing warning comment. A separate
`description` field shipped alongside `scope`: `name` only ever fed a bare label into the
report, never real guidance — `description` renders actual fix guidance under the message.

**Second amendment:** `description` made mandatory whenever `name` is set (decode-time
cross-field check), not left to authorial memory — a named rule with no description now
fails config decode entirely. Refuted the "mandatory for every rule" alternative: an
unnamed rule's report line is already self-explanatory, so forcing a description there
would just be filler. Verified by real falsification against this repo's own `.cairnrc.json`.

**Third amendment:** re-examining this repo's own 7 "design-package requires X" rules
(left unnamed on the self-explanatory theory) found that theory didn't survive contact with
"why DOES a design package need its own spikes.md" — all 13 rules are now named with real
descriptions. Same principle extended to `KindDef`: a bare kind id has no auto-generated
sentence around it, so `description` there is unconditionally required — every one of this
repo's 8 kinds now carries one.

**Amendment: rule-naming vocabulary refined.** An early catch-all `grounded_by` was found
to conflate three different relationships once each rule's actual claim was re-read: kept
for genuine argument-citing-evidence cases, split into `builds_on` (implementation built on
a validated spike) and `sourced_from` (content restated from a spike). The corrected names
and a broader reference vocabulary now live in `docs/design/CONVENTION.md`.

**Amendment: dev-issue linking, and an unmodeled product-issue layer.** Plain-text "issue
#101" mentions were replaced with one real link per doc. At the time this stayed
unenforced — `checks.coverage`'s `CoverageTarget` had no URL variant, only path/
`{external: 'path'}`. A related "product issue" layer (interview/user-feedback signal
upstream of a dev issue) was raised and deliberately left unmodeled: this repo has no real
product-feedback content to ground it in — still open.

**Amendment: shipped as a skill, and judged by adversarial review.** `cairn init --agent
claude` now scaffolds `.claude/skills/cairn-design-package/SKILL.md` teaching this whole
convention, locked in with a real integration test. Two context-free adversarial reviews
were run against the convention's own claims: purpose-clarity holds for a developer reader
but is refuted for a product reader; schema expressiveness (`KindSelector`/`CoverageTarget`/
`CoverageRequirement`/`CoverageRule.scope`) is refuted outright. Findings, a judge-prompt,
and measurable checks are in `docs/design/CONVENTION.md`; reusable, domain-agnostic versions
of the review prompts are in `docs/design/review-prompts.md`.

**Amendment: the URL-pattern gap closed.** `CoverageTarget` gained a third, purely additive
variant, `{ external: 'url', pattern }` — satisfied by a link whose raw href contains
`pattern` (plain substring, not regex/glob). Needed one structural change beyond the schema:
`DocMetadata.ts` previously dropped a non-checkable (URL) link entirely; it's now captured
as its own `urlRef` node so a url-pattern rule has data to match. Dogfooded for real: this
repo's `.cairnrc.json` now requires `problem-space` to link something matching
`https://github.com/sledorze/cairn/issues/` (`traces_to`), verified green against the real
`101-refs-symbol-scoping` package and falsified (link removed → real failure, restored →
green again). The match stays a plain substring, not a real URL grammar — a too-loose
pattern can still silently accept the wrong repo. The product-issue/vision layer remains
open.

**Amendment: the `scope` sibling/corpus-wide granularity gap closed — one new, narrower gap
found while closing it.** `scope` gained a second, purely additive variant, `{ under:
'some/project/relative/dir' }` — satisfied by a `to`-kind doc nested anywhere below `under`
(matched via a root-independent `**/<under>/**` glob, not a string-prefix compare); `'sibling'`
keeps behaving identically. Round 5 of the dedup-key bug (see `CheckCoverage.ts`'s own
comment) hit again on sight — the existing `${r.scope ?? ''}` string-coercion stringifies any
object `scope` to `"[object Object]"` regardless of its real `under` value, so two rules
differing only by `under` would have silently collapsed; fixed with `JSON.stringify`, falsified
both directions with a real test. Dogfooded for real against a throwaway two-team fixture:
the real CLI correctly flags a roadmap linking a spike OUTSIDE its scoped sub-tree while
passing one linking a spike nested several directories INSIDE it. An independent, context-free
adversarial reviewer (a fresh agent with no prior context, asked to break the change) found and
this task fixed a second, more severe bug BEFORE shipping: `under: '/'` (or `''`/`'///'`, any
value trimming to empty) collapsed the matcher's glob into one matching every path in the
corpus — a silent, vacuous "satisfied," proved by a real cross-satisfied unrelated doc — worse
than a disclosed limitation because it fails silent, not loud. Fixed by rejecting an
empty-after-trim `under` at decode time; falsified for real (the same CLI now refuses to load
that config at all). A third, narrower gap remains open, found applying the adversarial-judge
prompt to this same capability (`docs/design/review-prompts.md`'s section 4): `under` still has
zero validation against the config's real `roots`, unlike `from`/`to` kind ids — a typo
silently makes a rule permanently unsatisfiable, with nothing pointing at the cause. Not fixed
here (needs a `CairnConfigSchema`-level cross-field check, a different point in the schema tree
than
today's `CoverageInputSchema`-only check); recorded as open, not glossed over.
