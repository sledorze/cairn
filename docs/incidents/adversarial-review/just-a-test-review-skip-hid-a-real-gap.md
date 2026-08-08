# Incident: skipping adversarial review because "it's just a test" hid a real gap

## What happened

A commit added one new test asserting `refsPlugin.run`/`.stamp` correctly wire
`resolved.refs.scope` through. Pushed without adversarial review — reasoned, wrongly, that
"I only added a test" was the trivial exception review can be skipped for. A later,
retroactive review (run specifically because the assumption was questioned) found the test
covered only `refsPlugin.run`'s wiring, not `.stamp`'s identical line. Reproduced by
mutation: deleting only `.stamp`'s wiring left the entire suite, including the new test,
green.

## Root cause

`checkRefs` (driven by `.run`) recomputes its own classification independently at check
time, from the same config `.stamp` also reads — so a broken `.stamp` wiring was invisible
to a test that only exercised the `.run` path, even though the test's own name/comment
claimed to cover both.

## Fix

A second test asserting the raw artifact `.stamp` itself wrote (a sidecar file), independent
of `.run`'s own recompute — the only way to actually prove `.stamp`'s wiring, not just
assume it from `.run`'s.

## Rule this produced

See `AGENTS.md`'s adversarial-review rule: "just a test file" is not the trivial exception.
