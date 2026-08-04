# Implementation details (issue #101) — summary

**Release 1** (concrete, ready to implement): new `refs.scope` config
key (`RefsScopeGroupInputSchema`: `{glob, unit}`, first-match-wins),
namespaced under a new top-level `refs` key (not `checks.*`, since
`--refs` stays CLI-flag-gated). `resolveReferenceContent` gets a
`unit` param; `unit === 'ignore'` short-circuits before any filesystem
read. Reuses `matchesConfiguredGlob`-style glob matching from
`CheckDocCoverage.ts` rather than duplicating it a third time.
`CheckRefs.ts` already exports a real `refsPlugin: CheckPlugin`,
already registered in `cli.ts` — `refs.scope` is new config threaded
into that EXISTING plugin, not a new registry integration (corrects
an earlier draft's false claim that `CheckRefs.ts` "isn't a
`CheckPlugin`" — it already was, before this design branch forked).
`typescript` must become an optional `peerDependency` (Release 2),
matching `effect`/`github-slugger`'s existing precedent, never a hard
bundled dependency.

**Release 2** (provisional): a new pure `core/links/TsExports.ts`
module using the scanner primitive `spikes.md` validated, locating
each `export` declaration's byte range. Open question deliberately
left unresolved here: signature-only vs. whole-declaration hashing —
needs a second spike against real cases at implementation time.
Exports hashed in canonical (name-sorted) order so meaning-preserving
reordering isn't reported as drift. `RefRecord` gains an optional
`exportHashes` field — additive, no `REFS_VERSION` bump needed.

**Release 3** (provisional): reuses Release 2's extractor keyed by the
citation's own anchor; must return the full found-export-name set even
when tracking one, so a rename is diagnosable rather than a bare
`undefined`.

**Cross-cutting:** isolate all `typescript/unstable/*` usage behind
one narrow internal function, since that surface is explicitly
unstable; every new read path reuses `isSafelyWithinBase`, never a new
unaudited one.
