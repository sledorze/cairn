# Finding: root docs keep getting bespoke, one-off enforcement tests

## What recurred (and what didn't)

`AGENTS.md`/`README.md`/`CLAUDE.md` sit outside cairn's scanned `docs/` root (`isDir` in
`src/config.ts` drops a bare-file `roots` entry), so cairn's generic engine can't reach
them. Two merged, independent tests each hand-rolled a narrow content-coverage check to
compensate: [`jsonIncompatibility.readme.unit.test.ts`](../../../src/jsonIncompatibility.readme.unit.test.ts)
(message substring in README) and [`flagReadme.unit.test.ts`](../../../src/flagReadme.unit.test.ts)
(every CLI flag mentioned in README; names the former as its precedent). Neither checks
links — this is "bespoke enforcement instead of a generic fix," not specifically a
link-checking gap.

A third test, `agentsMdLinks.unit.test.ts`, extends that to link resolution — but it's an
**open, unmerged PR (#148)**, same author/day as this finding. Citing it as a fully
independent recurrence would overstate the evidence; it's a live proposal, not proof.

## Shape of a future fix (finding only — not started)

[`checkLinks`](../../../src/program/links/CheckLinks.ts) only needs a flat file list, not
directory-summary/coverage machinery — smaller than it looks. Shape: two separate `check`
invocations, not one unified `roots` list — a lightweight, link-only config for
root/AI-instruction files, plus the existing config for `docs/`.
[`layerConfig`](../../../src/core/Config.ts) already merges config layers on the fly, but
into one resolved config per run; it doesn't scope rules per root-group in one run.
Blocker either way: `roots` needs a literal-file entry (`isDir` requires a directory;
`roots: ["."]` walks the whole repo, not a shortcut).
