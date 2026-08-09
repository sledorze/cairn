# Solution space summary: making root-level docs reachable (issue #151)

Four candidates evaluated:

1. **`roots` accepts a literal file entry** — widen `expandOne`/`isDir` (`config.ts`) and
   `DocsFs.listFiles`/`walk` to include a file-shaped root directly instead of recursing.
   Reuses every existing containment guarantee unchanged; `isInScope`'s equality branch
   already handles file-root scope membership for free. Recommended.
2. **`ignore`-pattern shallow scan (`roots: ["."]` + `ignore: ["*/"]`)** — REJECTED,
   disproven live: real repro against this repo shows it correctly scans `AGENTS.md` but
   wrongly reports 4 real `docs/incidents/**` links as broken, because directory pruning
   (`isPrunedDir`) also strips those directories from the link-existence universe
   `CheckLinks.ts` checks against. `ignore` conflates "exclude from scan" with "exclude
   from existence" — harmless for its original `node_modules` use case, wrong here.
3. **Keep writing bespoke tests (status quo)** — rejected as the durable answer; this IS
   the problem, not a fix, per `docs/incidents/recurrence-gate/three-bespoke-root-doc-checks.md`.
4. **Two separate `cairn check` invocations**, one link-only scoped to root files, once
   option 1's primitive exists — necessary because `layerConfig` (`Config.ts:1110`) only
   merges one resolved config per run, with no per-root-group check scoping within it.

Recommendation: option 1 ships as Release 1, consumed in option 4's shape (a second
`--links-only` invocation), not folded into the main `docs/` config.

See [solution-space.md](./solution-space.md) for full pros/cons and the real disproof
transcript.
