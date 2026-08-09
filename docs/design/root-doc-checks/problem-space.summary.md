# Problem space summary: root-level docs can't be checked by cairn (issue #151)

`roots`'s resolution (`expandOne`/`isDir`, `src/config.ts:184-220`) filters every candidate
path down to existing directories only — a `roots` entry resolving to a real **file**
(`AGENTS.md`, `README.md`, `CLAUDE.md`, all repo-root files) is silently dropped, so
cairn's own link/summary/coverage engine can never reach them. Reproduced live: `node
dist/cli.js check --root AGENTS.md --links-only` reports "No documentation roots found,"
0 files checked, despite `AGENTS.md` containing real, checkable links.

Two independent, already-merged tests (`src/jsonIncompatibility.readme.unit.test.ts`,
`src/flagReadme.unit.test.ts`) hand-roll narrow content-coverage checks to compensate,
each re-deriving its own notion of "source of truth" from scratch. A third
(`src/agentsMdLinks.unit.test.ts`, open PR #148) proposes extending the pattern to link
resolution but isn't merged — cited as a proposal, not a third confirmed instance, per
`docs/incidents/recurrence-gate/three-bespoke-root-doc-checks.md`, this design's evidence
basis.

The real problem isn't one stale link — it's that cairn, a tool built to replace
hand-maintained documentation discipline with generic verification, cannot verify its own
most-read documentation, and every attempted workaround so far has been a new bespoke
one-off test: the exact anti-pattern cairn exists to prevent, recurring on itself.

Constraints: never widen reads beyond explicit `roots`; stay backwards compatible; a
file-root must not silently inherit summary/coverage obligations nobody asked for; no
fifth bespoke test; `--refs` granularity is explicitly out of scope (see
`docs/design/101-refs-symbol-scoping/`).

See [problem-space.md](./problem-space.md) for the full evidence and reasoning.
