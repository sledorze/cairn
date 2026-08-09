# Spikes summary: feasibility evidence for issue #151

- **Spike 1** — confirms today's failure for real: `node dist/cli.js check --root
AGENTS.md --links-only` reports 0 roots found, 0 files checked, despite `AGENTS.md`
  being real and link-bearing.
- **Spike 2** — disproves the `ignore: ["*/"]` shallow-scan workaround (solution-space
  option 2) live: a real temp config (`roots: ["."]`, `ignore: ["**/node_modules/**",
"*/"]`) correctly scans `AGENTS.md` but wrongly reports 4 real, resolvable
  `docs/incidents/**` links as dead — directory pruning (`isPrunedDir`) removes those
  directories from the link-existence universe too, not just the scan set.
- **Spike 3** — traces the actual size of option 1's code change end to end (no code
  changed in `src/`, a read-only trace): `expandOne`'s terminal filter needs one widened
  condition (`isDir(p) || isFile(p)`); `DocsFs.ts`'s real `listFiles` needs one new branch
  (stat the root, include directly if it's a file, walk as today if it's a directory); the
  in-memory test double needs **zero** changes, since `isInScope`'s existing equality
  branch already covers a file-root's scope membership. Conclusion: a few localized lines,
  not a deep refactor.

Changes to solution-space's ranking: option 2 moves from "plausible, untested" to
"confirmed broken"; option 1's cost moves from "assumed, unknown size" to "confirmed
small."

See [spikes.md](./spikes.md) for the full transcripts and reasoning.
