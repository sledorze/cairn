# Roadmap (issue #101) — summary

**Release 1 has shipped** (ADR 0004, now `accepted`). Releases 2/3 remain provisional.

Release 1 ships before Release 2 not because Release 2 is too risky
to attempt directly (its core mechanism was already spike-confirmed
before this roadmap was written) — the real reason is narrower:
Release 1 needs zero new dependency and has no open design question,
while Release 2 has one (signature-only vs. whole-declaration
hashing) still needing real evidence. A team that resolves that
question early could reasonably combine both into one release; this
split is the more conservative sequencing, not the only valid one.

Three independently-shippable releases:

- **Release 1** — `refs.scope` config (`whole-file`/`ignore` per
  glob). Zero new dependency. Directly resolves the reporter's own
  repro. No migration impact — absent config keeps today's behavior.
- **Release 2** — `unit: "exports-only"`: hash a file's exported
  declarations (found via the spike-validated `typescript/unstable/ast`
  scanner), not its whole content. Solves the general case with no
  facade restructure required. TypeScript/JS only for v1 — a
  non-matching language falls back to `whole-file`, never a false
  green. Switching a glob's unit invalidates its existing recorded
  hash — a loud, one-time, clearly-labeled mass re-stamp.
- **Release 3** — symbol-scoped citations (`#name` anchors), narrowing
  to one declaration. Gated on real usage evidence after Release 2,
  and a hard requirement: a renamed cited symbol must report a
  distinct, actionable error, never a silent pass.

Out of scope for all three: the rejected git-diff heuristic (option
C), any change to `checks.docCoverage` itself, cross-repo symbol
citation.
