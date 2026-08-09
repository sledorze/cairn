# Solution space: making root-level docs reachable (issue #151)

Four candidates, matching the four named in the issue/recurrence-gate finding plus the
task framing this package was opened against. Evaluated against `problem-space.md`'s
constraints, grounded in the actual code, not assumed.

## 1. `roots` accepts a literal file entry — a new primitive

Widen `expandOne`/`isDir` in [`src/config.ts`](../../../src/config.ts) (~lines 175-225) so
a `roots` pattern that resolves to an existing **file**, not just a directory, is kept
rather than dropped. Widen `DocsFs.listFiles`/`walk`/`recurseIntoDir`
([`src/io/DocsFs.ts`](../../../src/io/DocsFs.ts)) so a file-shaped root is included
directly in the result, not handed to `walk` (which assumes every root is a directory to
`readdir`).

**Pros:** the only option that actually gives `roots: ["AGENTS.md", "README.md"]` real
meaning. Reuses every existing containment guarantee
(`assertNoRootEscape`/`isSafelyWithinBase`) unchanged — a file-shaped root is
resolved through the exact same pattern-expansion path a directory-shaped one already is,
so no new escape surface. `checkLinks`'s own scope-membership check, `isInScope`
(`core/paths.ts:62`, `p === r || p.startsWith(`${r}/`)`), already treats an exact-match
path as in-scope — a root that IS a file, not a directory containing files, is already
correctly handled by that equality branch with zero changes needed there.

**Cons:** touches two files (`config.ts`, `DocsFs.ts`) instead of zero — this is a real
primitive change, not configuration. Left open by this option alone: what happens to
`checks.summaries`/`checks.coverage`/`checks.docCoverage` once a file-shaped root exists —
see `roadmap.md`'s Release 1 scoping decision. [`spikes.md`](./spikes.md) traces the actual
size of this change end-to-end; it is small, not a deep refactor.

## 2. `ignore`-pattern-based shallow scan (`roots: ["."]` + `ignore: ["*/"]`) — REJECTED, disproven live

Tried as a zero-code-change alternative: point `roots` at the repo root (`"."`) and use an
`ignore: ["*/"]` pattern to prune every subdirectory, leaving only root-level files in
scope. No `expandOne`/`DocsFs.ts` change needed — the existing `ignore` machinery already
prunes directories before recursing (`isPrunedDir`, `DocsFs.ts`'s own issue #63 fix).

**Confirmed broken, not a hunch** — reproduced against this repo's real build:

```
$ cat /tmp/.../root-doc-checks-spike-config.json
{ "roots": ["."], "ignore": ["**/node_modules/**", "*/"] }
$ node dist/cli.js check --links-only --config /tmp/.../root-doc-checks-spike-config.json
❌ 4 dead link(s):
  /workspaces/cairn/AGENTS.md
    ✗ [`docs/incidents/verify-before-push/`](docs/incidents/verify-before-push) (no unique target)
    ✗ [`docs/incidents/red-before-green/`](docs/incidents/red-before-green) (no unique target)
    ✗ [`docs/incidents/adversarial-review/`](docs/incidents/adversarial-review) (no unique target)
    ✗ [`docs/incidents/branch-hygiene/`](docs/incidents/branch-hygiene) (no unique target)
```

Every one of those four links is real and resolves correctly under the normal `roots:
["docs"]` config — this run reports all four as broken. `ignore: ["*/"]` correctly prunes
every subdirectory from the SCAN (so `AGENTS.md` itself is found and checked — the shallow
scan half of the idea genuinely works), but `DocsFs.listFiles`'s directory pruning also
removes those same subdirectories from the **existence universe** `CheckLinks.ts`'s
`resolvePendingCheck` resolves link targets against
([`src/program/links/CheckLinks.ts`](../../../src/program/links/CheckLinks.ts), the
`checkLinks` function starting at line 381; its own comment at lines 396-401 explicitly
documents this exact tradeoff: "a link pointing into a pruned directory now reports broken
instead of resolving — considered acceptable" — written for the OOM fix's actual use case
(an ignored `node_modules`), not anticipating this repurposing).

**Root conflation this exposes:** `ignore` was designed to answer one question — "what do I
exclude from scanning as a source of citations/docs" — and reusing it to answer a
structurally different question — "what subset of the tree counts as existing, for link
resolution" — silently conflates the two. A directory can legitimately be "don't scan this
FOR docs" without meaning "don't let anything resolve INTO this." Rejected as a real,
disproven direction, not a plausible-sounding one left untested.

## 3. Keep writing bespoke tests — status quo / do nothing

Continue the pattern `jsonIncompatibility.readme.unit.test.ts`/`flagReadme.unit.test.ts`
already established, and merge PR #148's `agentsMdLinks.unit.test.ts` as a third instance
of the same pattern, extended to link-checking.

**Pros:** zero new primitive, ships today, each individual test is well-scoped and already
proven to catch real gaps (both merged tests found real pre-existing drift on their own
first RED run).

**Cons:** this IS the problem `problem-space.md` names, not a fix for it — a fourth
one-off, hand-rolled check joining two already-merged ones, each independently
re-deriving its own notion of "source of truth" and "how to compare." Every future
root-level obligation (a new flag, a new incompatibility, a new cited path) needs its own
bespoke assertion, forever, rather than inheriting cairn's existing generic engine the way
every doc under `docs/` already does. `docs/incidents/recurrence-gate/three-bespoke-root-doc-checks.md`
is precisely the cost ledger for this option: two real, independent instances already paid
for, with a third proposed. Rejected as the DURABLE answer — recorded as the baseline this
design measures itself against, not resurrected as the actual recommendation.

## 4. Two separate `cairn check` invocations, one link-only scoped to root files

Once option 1's literal-file-roots primitive exists, run `cairn check` **twice**: the
existing invocation, unchanged, against `docs/` (summaries + coverage + links); and a
second, narrower invocation — `--links-only`, `roots: ["AGENTS.md", "README.md",
"CLAUDE.md"]` — that checks only link resolution for the root files, with no
summary/coverage obligations attached to them.

**Why two invocations, not one merged config:** `layerConfig`
([`src/core/Config.ts:1110`](../../../src/core/Config.ts)) merges config layers
(`extends`/file/CLI overrides) into exactly **one resolved config per run** — `roots` is a
single field that replaces wholesale per layer (`...(layer.roots === undefined ? {} :
{ roots: layer.roots })`), not appended to across layers, and there is no per-root-group
scoping of WHICH checks apply to WHICH roots within one run. Folding `AGENTS.md` into the
same `roots` array as `docs` in one config would mean it inherits every check that config
enables — `checks.summaries`'s directory-summary requirement, `checks.coverage`'s
design-package kind matching — none of which make sense for a root instruction file. Two
separate invocations, each with its own narrow, purpose-built config, is what
`docs/incidents/recurrence-gate/three-bespoke-root-doc-checks.md`'s own "shape of a future
fix" section already anticipated, confirmed still correct against the real `Config.ts` code
read for this package.

**Pros:** solves the actual reported pain (root-level links go unchecked) with the
smallest true obligation — no new schema field for "which checks apply to which roots,"
just a second, ordinary `cairn check` invocation with its own ordinary config (CLI flags or
a second `--config` file). Composes cleanly with CI (two `cairn check` steps, or one script
running both).

**Cons:** two invocations to keep passing in CI, not one — a real, if small, ongoing cost
(two commands instead of one in whatever CI job runs this). Doesn't unify root-file and
`docs/`-tree checking into a single mental model; an author has to know both invocations
exist. Only viable once option 1 ships — this candidate is not a standalone alternative to
option 1, it's the SHAPE option 1's own output gets used in.

## Synthesis — this package's recommendation (detailed in `roadmap.md`)

**Option 1 (literal-file-roots primitive) ships as Release 1**, consumed as **option 4's
shape** (a second, `--links-only`, root-file-scoped invocation) rather than folded into the
existing `docs/` config. **Option 2 is rejected outright**, with real disproof recorded
above — not revisited unless `CheckLinks.ts`'s pruned-directory tradeoff itself changes for
independent reasons. **Option 3 (status quo) is the cost this design replaces** — PR #148
should be superseded once Release 1 ships (see `roadmap.md`), not merged as a permanent
parallel mechanism alongside a now-working generic path.
