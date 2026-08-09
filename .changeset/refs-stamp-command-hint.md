---
'@sledorze/cairn': patch
---

`cairn check --refs`'s stale-reference report now points its "Fix:" hint at a new,
dedicated `refsStampCommand` config field (default `npx cairn check --refs --stamp`)
instead of a hardcoded guess. Previously the hint always suggested `pnpm run stamp:refs`
as a fallback regardless of whether that script actually existed in the repo, and never
read the repo's own configured stamp command the way the summaries report already reads
`stampCommand` — so a repo whose real ref-stamping command needed a formatter step first
(or used a different script name) got a hint that either didn't work or reproduced a
stale-summary trap it had already configured its way out of. `refsStampCommand` is
deliberately a separate field from `stampCommand`, not a reuse of it: `stampCommand` is
conventionally scoped to summary freshness (commonly `--summaries-only`, as this repo's
own config does) and does not stamp `--refs` sidecars at all (issue #162, item #1).
