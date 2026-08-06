# Roadmap (issue #137) — summary

Five releases; unlike `101-refs-symbol-scoping/roadmap.md`, the split here is genuinely
load-bearing, not just conservative sequencing — it exists specifically to avoid repeating
the killed `checks.claims` episode's mistake of designing generic runners ahead of real
need.

- **Release 0** — an explicit ROI checkpoint (adversarial review of this design's actual
  cost), not code. "Don't build this" is a legitimate outcome.
- **Release 1** — the Must tier (declare, validate, mandatory evidence, gap report) plus
  the one Should-tier runner already proven in spike 7 (`covers set:published-files`),
  shipped together because Must alone can't catch the reproduced #130 incident.
- **Release 2** — `symbol:path#Name` objects, reusing ADR 0004's own validated scanner
  primitive; explicitly supersedes (amends) ADR 0004's Release 3 only, leaving its
  Releases 1–2 untouched.
- **Release 3** — modality-grouped reporting, closing #133, strictly stronger than #133's
  own proposed doc-vs-source label.
- **Release 4** — one more Should-tier predicate, chosen from real accumulated `open`
  relations in this repo's own docs, deliberately unscoped here.

Out of scope for every release: the Could-tier review-prompt generation, adjudicating
undecidable relations, executing arbitrary project code — all per the issue's own MoSCoW.
