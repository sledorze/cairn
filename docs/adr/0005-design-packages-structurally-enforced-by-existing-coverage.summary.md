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
