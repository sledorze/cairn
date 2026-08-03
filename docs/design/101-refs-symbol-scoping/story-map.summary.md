# Story map (issue #101) — summary

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
