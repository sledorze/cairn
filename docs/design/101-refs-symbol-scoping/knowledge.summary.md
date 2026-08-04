# Knowledge / skill (issue #101) — summary

**Core invariant every release must preserve:** a `unit` config change
must never make `--refs` silently MORE lenient than it should be —
real drift on an exported declaration must still be caught. Precision
errors must always favor "still catches the real thing."

**This package's own adversarial review found three of its OWN claims
wrong on first draft**, not merely stale — spike 4's original code
didn't even run (wrong API signature, nonexistent enum member, would
hang forever), a false claim that `CheckRefs.ts` "isn't a
`CheckPlugin`" (it already was), and a fabricated quotation attributed
to `AGENTS.md`. Each was caught only by actually re-running code or
re-grepping, not by re-reading prose.

**Before extending Release 2/3:** re-run the spikes (using the
CORRECTED code in `spikes.md`) against the CURRENT `typescript`
version — the `unstable/*` surface can shift without warning.
Re-verify line-number citations. Re-verify ARCHITECTURAL claims
("X isn't a Y yet") by grepping, not by pattern-matching from memory.
Never trust a quotation mark around text attributed to another file
without opening that file and finding the exact string.

**The reusable pattern from this design, for the next issue like it:**
ground every option in the real, already-owned dependency graph before
proposing a new one (found via actually running code, not general
knowledge); enumerate options wider than the issue itself proposes,
ranked by the same constraints; story-map the real workflow, not the
feature list, to surface hard requirements (like Release 3's
rename-resilience gate) that a pure option-comparison wouldn't; and
sequence releases by real cost/value, not "logical" build order.

**Connects to `checks.docCoverage`:** this design's own future source
files must be cited from `docs/architecture.md` for real (a genuine
link, not a bare mention) once implemented — the same gap
`problem-space.md` itself is about.
