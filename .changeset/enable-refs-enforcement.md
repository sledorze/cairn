---
---

No package bump: enables `--refs` in `pnpm check` (the script driving lefthook and CI) and
adds a `stamp:refs` script — dev-workflow-only, no change to the published package's
behavior. `.cairn/refs/**` sidecars, stamped once years ago and stale since, are refreshed
for real. Dogfoods ADR 0004's own suggested next step now that Release 1 (`refs.scope`)
exists. Verified via a real RED-before-GREEN pass: edited a cited `src/*.ts` file, confirmed
`pnpm check` caught it, reverted, confirmed clean.
