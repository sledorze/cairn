# Knowledge summary: reaching root-level docs with a generic checker (issue #151)

Core lesson: a scanning-exclusion mechanism (`ignore`, "what to skip while looking for
sources") and an existence universe (`known`, "what counts as resolvable for a link
target") are two different concerns even when one implementation (`DocsFs.listFiles`'s
directory pruning) happens to feed both — reusing the exclusion mechanism for the
existence question silently inherits a side effect it was never designed to have. The same
shape of mistake `docs/design/101-refs-symbol-scoping/problem-space.md` already
names for `ignore` vs. `--refs`; recognize it as one recurring lesson, not two unrelated
ones.

Verification discipline: this design's two most load-bearing claims (today's failure is
real; the `ignore`-pattern workaround is broken) were both run against the actual built
CLI before being written down, not accepted from a static code read alone — the gap
between "plausible from reading the code" and "confirmed by running it" is exactly what a
spikes section is for, and it's the cheap-looking, plausible-sounding workaround (not the
obviously-hard option) that most needs this discipline, since it's the one confirmation
bias is least likely to make anyone double-check.

Process pattern worth reusing: run a cheap recurrence gate before any design work and cite
it rather than re-deriving it; state the evidence basis's real size honestly, including
what does NOT generalize (a proposed-but-unmerged PR doesn't count as a confirmed third
instance); when a fix touches a shared primitive, explicitly decide and record what does
NOT change, not just what does; trace a "how big is this change" claim against the real
current source before writing a roadmap around it — including when the answer turns out to
be "smaller than expected," not just "bigger."

See [knowledge.md](./knowledge.md) for the full write-up.
