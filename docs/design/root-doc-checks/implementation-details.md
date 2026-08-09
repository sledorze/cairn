# Implementation details: issue #151, Release 1 only

Concrete enough to start from directly — grounded in [`spikes.md`](./spikes.md)'s Spike 3
trace of the real, current source, not a hypothetical diff.

## `src/config.ts`: `expandOne`'s terminal filter

Today (`config.ts:220`):

```ts
const isDir = (p: string): Effect.Effect<boolean, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const info = yield* fs.stat(p).pipe(Effect.catch(() => Effect.succeed(null)))
    return info !== null && info.type === 'Directory'
  })
```

Add a sibling, same shape:

```ts
const isFile = (p: string): Effect.Effect<boolean, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const info = yield* fs.stat(p).pipe(Effect.catch(() => Effect.succeed(null)))
    return info !== null && info.type === 'File'
  })
```

`expandOne`'s terminal loop (`config.ts:210-216`) widens from:

```ts
const dirs: string[] = []
for (const p of current) {
  if (yield * isDir(p)) {
    dirs.push(p)
  }
}
```

to:

```ts
const dirs: string[] = []
for (const p of current) {
  if (yield * isDir(p) || yield * isFile(p)) {
    dirs.push(p)
  }
}
```

No other line in `expandOne` changes — the intermediate `**`/wildcard-segment resolution
(`readDirsSafe`, `descendantDirs`) stays exactly as it is, since a non-terminal glob
segment can only ever meaningfully match a directory. `assertNoRootEscape`
(`config.ts:249`) needs no change: its realpath-containment check is equally correct for
a file or a directory. `expandRoots`'s own signature (`readonly string[]`) doesn't need to
change either — a resolved file path and a resolved directory path are both just absolute
POSIX strings to every downstream consumer except `DocsFs.listFiles`, which is the one
place that actually needs to branch on which kind it got.

**Rename note:** the local variable `dirs` (now potentially containing files too) is
misleadingly named once this lands — rename to something neutral (`resolved`) as part of
the same change, not a follow-up, since it's a one-line rename touching no call sites
(the function's return type/signature is unaffected).

## `src/io/DocsFs.ts`: `listFiles`'s per-root branch

Today, `listFiles` (inside `DocsFsLive`'s `Effect.gen`, `fs: FileSystem.FileSystem`
already in scope):

```ts
const listFiles = (roots: readonly string[], ignore: readonly string[] = []): Effect.Effect<readonly string[]> =>
  Effect.gen(function* () {
    const out: string[] = []
    for (const root of roots) {
      const present = yield* fs.exists(root)
      if (!present) {
        continue
      }
      for (const abs of yield* walk(root, true, ignore, roots, root)) {
        out.push(toPosix(abs))
      }
    }
    return out
  }).pipe(Effect.orDie)
```

`walk` unconditionally `readdir`s `root` — throws (well, fails as a `PlatformError`, caught
by the `atRoot` branch's propagation) if `root` is a file, not silently empty. Needs one
new branch, checking the root's own type before deciding whether to walk or include
directly:

```ts
const listFiles = (roots: readonly string[], ignore: readonly string[] = []): Effect.Effect<readonly string[]> =>
  Effect.gen(function* () {
    const out: string[] = []
    for (const root of roots) {
      const info = yield* fs.stat(root).pipe(Effect.catch(() => Effect.succeed(null)))
      if (info === null) {
        continue
      }
      if (info.type === 'File') {
        // A file-shaped root has nothing to recurse into — include it
        // directly, subject to the same file-level ignore convention
        // `isPrunedDir`'s own header comment already documents for an
        // ordinary ignored file ("still only removes that one file from
        // the result").
        const absPosix = toPosix(root)
        if (!isPrunedDir(absPosix, ignore, root)) {
          out.push(absPosix)
        }
        continue
      }
      for (const abs of yield* walk(root, true, ignore, roots, root)) {
        out.push(toPosix(abs))
      }
    }
    return out
  }).pipe(Effect.orDie)
```

(`fs.exists` is replaced by `fs.stat` since the branch now needs `.type` anyway — one
syscall instead of two, not an extra one. `isPrunedDir`'s file-shaped-pattern handling
already works unchanged for this — its own header comment already documents that a
file-matching `ignore` pattern "still only removes that one file," which is exactly the
semantics a file-ROOT should honor too, e.g. an explicit `roots: ["AGENTS.md"]` combined
with an unrelated `ignore` pattern that happens to also match `AGENTS.md` should still
exclude it, consistent with every other file in the tree.)

**In-memory test double (`makeTestDocsFs`): no change needed.** Confirmed by
`spikes.md`'s Spike 3 trace — its `listFiles` already filters the flat `store` via
`isInScope(p, roots)`, whose own equality branch (`p === r`) already treats an exact root/
path match as in-scope. A unit test asserting this (see Tests below) should still be
added, not to fix a bug, but to lock in that the existing behavior is correct for this new
case and stays that way.

## `checkLinks`'s consumer path — no change needed, traced explicitly

`checkLinks` (in [`src/program/links/CheckLinks.ts`](../../../src/program/links/CheckLinks.ts)) calls `dfs.listFiles(roots, ignore)`
and treats the result as a flat file list from that point on (`buildBasenameIndex`,
`withAncestors`, `.filter((file) => file.endsWith('.md') ...)`) — nothing in `checkLinks`
itself assumes a root is a directory. Once `DocsFs.listFiles` includes a file-shaped root
in its output, `checkLinks` picks it up automatically, with zero changes: the root file
appears in `allFiles`, in `known` (via `withAncestors`), and — since it ends in `.md` — in
`mdFiles`, so it gets scanned as a citation SOURCE too, exactly like any other doc. This is
confirmed by tracing the function, not assumed from its name.

## `checks.summaries` / `checks.coverage` / `checks.docCoverage` — deliberately untouched

Per `roadmap.md`'s explicit scoping decision, Release 1 does not touch
`SummaryTree.ts`'s `planSummaries`, `CheckCoverage.ts`, or `CheckDocCoverage.ts` at all.
The root-file invocation runs with `--links-only`, which already skips the summaries
plugin entirely (`cli.ts`'s `config.checks.summaries && !parsed.linksOnly` guard, line 512) and the coverage plugins are simply not enabled in that invocation's own minimal
config (no `checks.coverage`/`checks.docCoverage` key present). No new "opt out" flag or
schema field is needed for this release — the exemption is structural, by virtue of what
the second invocation's config does and doesn't enable, not a new mechanism.

## Config schema — no new field needed for Release 1

Unlike `docs/design/101-refs-symbol-scoping/implementation-details.md`'s Release 1 (which
added a brand new `refs.scope` config key), THIS release adds **no new schema field at
all**. `roots` (`Config.ts:803`) already accepts `Schema.Array(Schema.String)` — any
string, including one that resolves to a file. The only schema-adjacent change worth
making is a documentation one: `roots`'s existing `description` annotation
(`Config.ts:805-809`, "Documentation roots to scan (globs allowed)...") should gain one
clause noting a literal entry may now resolve to a single file, not only a directory — so
`schema/cairn.schema.json`'s generated tooltip stays accurate (this repo's own `AGENTS.md`:
"a new restriction must be discoverable, not just correct" — the inverse also holds for a
newly-supported case, not just a new restriction).

## Tests

- Unit (`config.unit.test.ts` or equivalent): `expandRoots(cwd, ["some/existing/file.md"])`
  returns that file's absolute path; `expandRoots(cwd, ["some/nonexistent/file.md"])`
  returns nothing (matches today's silent-no-match behavior for a nonexistent directory
  pattern — no new error path introduced).
- Unit (`DocsFs.unit.test.ts` or equivalent, both `DocsFsLive` via a real temp dir AND
  `makeTestDocsFs`): `listFiles(["<file-root>"], [])` includes that file; a file-root
  matching an `ignore` pattern is excluded, same as any other file; a file-root combined
  with an ordinary directory-root in the same call returns both correctly (no regression
  to the existing directory-walk path).
- Integration/real-CLI dogfood (per this repo's own established convention — every check
  feature here has had a real gap dogfooding alone found): build the real CLI, run `cairn
check --links-only --root AGENTS.md` against THIS repo, confirm real links resolve;
  introduce a deliberate typo in one of `AGENTS.md`'s real `docs/incidents/**` links,
  confirm it's now reported broken; revert, confirm clean again. This is the direct
  RED/GREEN replacement for Spike 1's manual repro above, converted into a permanent test
  per this repo's own "convert every manual dogfooding proof into a permanent test" rule.
- Regression: the existing directory-root test suite (`config.unit.test.ts`,
  `DocsFs.unit.test.ts`, `CheckLinks.*.test.ts`) must stay green unchanged — this release
  is additive, not a rewrite of the directory path.

## Risks

- **The `isPrunedDir`/ignore-matching reuse for a file-root is new territory, not just a
  copy-paste** — `isPrunedDir` was written for pruning DIRECTORIES before recursion;
  calling it against a file-root's own path needs to be verified to actually produce the
  right true/false for a FILE path (its glob-matching logic itself is path-shape-agnostic,
  but this is the first call site using it this way) — flagged explicitly for whoever
  implements this to verify with a real test, not assumed correct by analogy alone.
- **Two invocations in CI is a real, if small, ongoing maintenance surface** — a future
  contributor who only remembers to update the `docs/`-scoped `cairn check` invocation
  (e.g. adding `checks.coverage` there) could forget the root-file invocation exists at
  all. Worth a comment at BOTH invocation sites in whatever CI config wires this up,
  pointing at each other and at this design package.
