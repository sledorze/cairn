# Design-package convention — summary

Design packages (`docs/design/<slug>/`) stay hand-authored prose — no
generated template — but their required shape (`_SUMMARY.md`,
`problem-space.md`, `solution-space.md`, `spikes.md`, `story-map.md`,
`roadmap.md`, `implementation-details.md`, `knowledge.md`) is
structurally enforced by cairn's EXISTING `checks.coverage` kinds/
rules mechanism, not a new config primitive. Each required role is a
declared `kind` (by path glob); a `design-package` kind's `_SUMMARY.md`
must link to one doc of each role — a missing or unlinked piece
reports as `missing coverage`.

**Reusable by any cairn consumer** — the config block is copy-pasteable
into any `.cairnrc.json`; kind-based, not filename-based, so a
different naming convention still works.

**Materialized and falsified for real**: enabled in this repo's own
`.cairnrc.json`, verified against the real `101-refs-symbol-scoping`
package (passes), then a link was removed from `_SUMMARY.md` and
caught three independent ways at once (missing-coverage, orphan
detection, link-completeness) — restored, green again.

**Honest limitation, found by adversarial stress-testing:** rules
aren't scoped per-package — a throwaway second package cross-linking
an existing package's docs (none of its own) passed cleanly. Closing
this needs a new same-directory selector relation or a dedicated
check — out of scope here, recorded as a known gap for multi-package
scale.

**Dev-issue linking:** every doc now carries one real
`[issue #101](github.com/.../101)` link (was plain unlinked text) —
real, but un-enforced (`checks.coverage` can't classify an external
URL as a kind today). **Product-issue/vision layer:** raised, not
modeled — this repo has no real interview/customer-feedback content
to ground it in, and inventing fictional data would break this
package's own evidence-based discipline; proposed as its own future
design package, filed as a real issue first.
