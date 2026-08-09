# Spikes: feasibility evidence for issue #151 (grounded, not assumed)

Every claim below was run against this repo's actual built CLI, or traced against the
actual current source, not asserted from general knowledge.

## Spike 1 — does today's `isDir` filter really drop a file-shaped root? (confirms `problem-space.md`'s headline claim)

**Question:** does `roots: ["AGENTS.md"]` actually fail the way `problem-space.md` claims,
or is that an assumption never run for real?

**Method:** built the real CLI (`pnpm build`) and ran it against a file-shaped `--root`
override.

**Result: confirmed, run for real.**

```
$ node dist/cli.js check --root AGENTS.md --links-only
⚠️  No documentation roots found (looked for: AGENTS.md).
✅ Markdown links OK (0 file(s) checked).
```

`AGENTS.md` exists at the repo root and is well over the summary threshold. `isDir`
(in [`src/config.ts`](../../../src/config.ts)) silently drops it, exactly as the code read predicts — 0 files
checked, no error, a doc that's real and readable treated as if it doesn't exist.

## Spike 2 — is the `ignore: ["*/"]` shallow-scan workaround actually viable? (option 2, disproven live)

**Question:** solution-space option 2 proposes `roots: ["."]` + `ignore: ["*/"]` as a
zero-code workaround. Does it actually work, or only look plausible on paper?

**Method:** wrote a real temp config and ran the real built CLI against it, from the repo
root:

```json
{ "roots": ["."], "ignore": ["**/node_modules/**", "*/"] }
```

```
$ node dist/cli.js check --links-only --config <that file>
❌ 4 dead link(s):
  /workspaces/cairn/AGENTS.md
    ✗ [`docs/incidents/verify-before-push/`](docs/incidents/verify-before-push) (no unique target)
    ✗ [`docs/incidents/red-before-green/`](docs/incidents/red-before-green) (no unique target)
    ✗ [`docs/incidents/adversarial-review/`](docs/incidents/adversarial-review) (no unique target)
    ✗ [`docs/incidents/branch-hygiene/`](docs/incidents/branch-hygiene) (no unique target)
```

**Result: confirmed broken, not a hunch.** These four links are real and resolve
correctly under the repo's normal `roots: ["docs"]` config (`node dist/cli.js check
--links-only` against the default config reports them clean — verified in the same
session before writing this section). The shallow-scan half of the idea genuinely works
(`AGENTS.md` itself IS found and scanned as a source, proving `ignore: ["*/"]` does prune
subdirectories from the SCAN as intended) — but `DocsFs.listFiles`'s directory pruning
(`isPrunedDir`, `src/io/DocsFs.ts`) also removes those same pruned subdirectories from the
`known` existence universe `CheckLinks.ts`'s `resolvePendingCheck` checks link targets
against. `CheckLinks.ts`'s own header comment (lines 396-401) already discloses this
tradeoff for its original use case (excluding `node_modules` from existence, not just
scanning) — this spike is the first time it's been checked against THIS repurposing, and
it fails exactly as that comment would predict once you apply it to a directory (like
`docs/incidents/verify-before-push/`) that's real, not generated.

## Spike 3 — how localized is the `expandOne`/`walk` change option 1 actually needs? (traced, not guessed)

**Question:** the task framing for this design explicitly asks for a real answer, not an
assumption: is teaching `expandOne` (`config.ts`) and `walk`/`listFiles` (`DocsFs.ts`) to
handle a file-shaped root a few lines, or a deep refactor?

**Method:** traced `expandOne`, `DocsFs.listFiles`/`walk`/`recurseIntoDir`, and every
downstream consumer of `expandRoots`'s output end to end, reading the real current source
(not written from memory) — no code changed in `src/`, this trace stays a scratch
exercise.

**Finding — genuinely small on the `config.ts` side.** `expandOne`'s intermediate glob
expansion (`**`, wildcard segments) resolves each segment via `readDirsSafe`
(`config.ts:288`), which already filters to `isDir` — correct and unchanged, since a
glob's non-terminal segment can only ever meaningfully be a directory (`docs/*/x.md`'s `*`
can't itself be a file). Only the FINAL filter, after all segments are resolved

```ts
const dirs: string[] = []
for (const p of current) {
  if (yield * isDir(p)) {
    dirs.push(p)
  }
}
```

needs widening — to keep `p` when it's a file too (`isDir(p) || isFile(p)`, a new sibling
predicate mirroring `isDir`'s own three-line shape exactly). `assertNoRootEscape`
(`config.ts:249`) needs no change at all: it only checks a resolved path's realpath
containment against `cwd`, a check that's equally correct whether the resolved path is a
file or a directory.

**Finding — small but real on the `DocsFs.ts` side, and asymmetric between the two
implementations.** `DocsFsLive`'s `listFiles` (`DocsFs.ts`) currently does, per root:

```ts
const present = yield* fs.exists(root)
if (!present) continue
for (const abs of yield* walk(root, true, ignore, roots, root)) { ... }
```

`walk` unconditionally calls `NodeFsPromises.readdir(dir, ...)` — which throws on a file
path, not silently returns nothing. So `listFiles` genuinely needs a branch: `fs.stat(root)`
(the `fs: FileSystem.FileSystem` service is already in scope inside `DocsFsLive`'s own
`Effect.gen`, no new dependency) and, when `info.type === 'File'`, push `root` directly into
the result (subject to the SAME `isPrunedDir`-equivalent ignore check a file already gets
elsewhere — `DocsFs.ts`'s own header comment already documents "a file-shaped ignore
pattern... still only removes that one file from the result," so a file-shaped ROOT should
honor the same convention) instead of calling `walk` at all. This is a small, localized
addition — one new branch in one loop — not a rewrite of `walk`'s recursive structure,
which stays untouched for every directory-shaped root exactly as it is today.

**Finding — the in-memory test double (`makeTestDocsFs`) needs ZERO changes.** Its
`listFiles` already filters the flat `store` by `isInScope(p, roots)`
(`core/paths.ts:62`), and `isInScope`'s own equality branch (`p === r`) already treats an
exact path match as in-scope — a root that happens to equal a stored file's own path (the
file-root case) is already handled correctly, for free, by logic written years before this
design existed for an unrelated reason (directory-prefix matching). Confirmed by reading
`isInScope`'s actual implementation, not assumed from its name.

**Conclusion — a real answer, not a hedge:** this is a few-lines change in two files
(`config.ts`'s final filter loop, `DocsFs.ts`'s real `listFiles`), plus zero change to the
test double. Not a deep refactor of `walk`'s recursion, not a new service method, not a
new IO capability. `implementation-details.md` writes the concrete diff shape from this
trace.

## What these spikes change about `solution-space.md`'s ranking

- Option 2 moves from "an untested but plausible zero-code alternative" to **confirmed
  broken** — the ranking no longer needs to hedge on it; it's disproven, not merely
  disfavored.
- Option 1's cost estimate moves from "assumed: touches two files, unknown size" to
  **"confirmed: a few localized lines in each, no deep refactor, no new service method,
  test double needs no change at all."** This directly de-risks Release 1's scope in
  `roadmap.md`.
