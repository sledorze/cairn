# Roadmap (issue #137) — summary

**Release 0's ROI checkpoint was actually run**, not just proposed — an independent
adversarial review against this design's real cost. **Verdict: don't build the full
vocabulary.** Six findings: evidence base (one maintainer, no outside corroboration)
doesn't support the investment size versus option B's much smaller cost; the recurrence
evidence (`falsestart`'s 12 checkers) is from a different repo, not a second recurrence
inside cairn itself; a closed predicate registry is a many-contributor governance defense
cairn's one maintainer doesn't need; ADR 0004's own Release 1 is already accepted, cheaper,
and still unbuilt — real opportunity cost; a cheaper "just write more careful prose"
alternative was never given a fair hearing; and two full design efforts landing on the same
"don't build the big version" conclusion is itself a process signal.

**What actually ships — Release 1 (accepted): solution-space option B only.** Declared
extra `--refs` targets, no predicate vocabulary. One small extraction function plus a
one-line union at one call site in `CheckRefs.ts`'s `stampRefs` — `checkRefs` needs zero
changes, since it already replays whatever's in the sidecar regardless of how the target
got there. Fully closes the one reproduced incident (#130, spike 7's shape) using only
existing `RefStore.ts` machinery.

**Releases 2–4 (on hold, kept as a rejected-options record, not deleted):** the original,
larger Release 1 (Must tier + `covers`), `symbol:path#Name` objects, modality-grouped
reporting, and further Should-tier predicates all build on the rejected vocabulary
architecture and stay on hold behind one shared trigger: a second, independently-shaped
incident recurring inside cairn's OWN repo that option B's extra-target mechanism genuinely
can't express — not a fixed date, not "if it becomes more important."

Out of scope regardless: the Could-tier review-prompt generation, adjudicating undecidable
relations, executing arbitrary project code — all per the issue's own MoSCoW.
