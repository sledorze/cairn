# Story map (issue #101) — summary

Opens with the required, verbatim-across-packages disclosure (short, framework-free — an
earlier draft using Team Topologies vocabulary was reverted on review as a poor fit for a
single-maintainer repo): every role is an internal engineering role (doc author, reviewer,
CI), not a customer persona — see [`../dependencies.md`](../dependencies.md) for this repo's
real cross-package relations, none of which involve this package as the dependent side.

Backbone (doc author's real workflow): cite implementation → stamp →
edit cited code → re-run `--refs` → decide if drift matters →
re-stamp or investigate.

Key stories per step: exempt noisy leaf files from tracking (Release
1); editing a private helper must NOT fail `--refs`, editing an
exported declaration a citation covers SHOULD (Release 2); renaming a
symbolically-cited export must produce an actionable error, never a
silent false-pass (Release 3's hard gate); `--stamp` must clearly
distinguish "expected mass-restamp from a config change" from
"content actually drifted." CI-parity/security items under "re-run
--refs" are kept as explicit non-negotiable constraints, not dressed
up as user personas.

**Walking skeleton:** Release 1 (`refs.scope` config) — ships
end-to-end, fully resolves the reporter's own repro, needs no new
parsing dependency.
