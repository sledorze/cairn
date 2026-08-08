---
---

No package bump: `docs/design/137-typed-relations/` is a new design package for issue #137
(typed relations) — problem-space, solution-space, spikes, story-map, roadmap,
implementation-details, and knowledge docs, plus their `.cairn/` sidecar stamps. No
production code changes; no behavior change to the published package. Verified via
`pnpm verify` (green) and a real RED-before-GREEN pass on `cairn check`'s own coverage gate.
