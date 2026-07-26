<p align="center">
  <img src="assets/logo.svg" width="120" height="120" alt="Cairn logo">
</p>

# @sledorze/cairn

Keep your documentation summaries honest. `cairn` enforces a hierarchical,
content-hashed summary tree over any docs folder — and fails CI when a summary drifts
out of date or a link goes dead.

## The problem

Docs summaries rot. Someone edits `guide.md`, forgets to update `guide.summary.md`, and
the digest now lies. The usual fix — "regenerate summaries when the source is newer" —
compares modification times. But **git does not preserve mtimes**: after a clone or a CI
checkout, every file looks freshly written, so a time-based check silently passes on
summaries that are actually stale. The bug you meant to catch ships anyway.

`cairn` checks **content**, not clocks. The SHA-256 of the source each summary
summarizes is recorded in a hidden sidecar under `.cairn/`, mirroring your docs tree —
never inside the summary itself, so the tracking system leaves zero bytes in the docs
you write:

```
.cairn/docs/guide.summary.md.json  →  {"sha256": "3f9a…(64 hex)", "version": 1}
```

The checker recomputes the source hash and compares it to the sidecar. Mismatch means
stale, missing means missing — and it behaves identically on your laptop and in CI,
before and after a clone. Commit `.cairn/` alongside your docs; it isn't gitignored.

## Install

```sh
pnpm add -D @sledorze/cairn
```

## Quick start

```sh
npx cairn check
```

The round-trip when you touch a doc:

1. **Edit** `docs/guide.md`.
2. `npx cairn check` **flags it stale** — the source hash no longer matches the
   sidecar recorded for `guide.summary.md`.
3. **Write** the updated `guide.summary.md` (and update any parent `_SUMMARY.md`).
4. **Stamp**: `npx cairn check --summaries-only --stamp` rewrites the `.cairn/`
   sidecar hashes bottom-up — your summary's content is never touched.
5. **Check** again — `npx cairn check` exits 0. Green.

You author the prose; the tool verifies and stamps. It never invents content, and it
never writes into content either.

### Commands

| Command                                   | What it does                                                               |
| ----------------------------------------- | -------------------------------------------------------------------------- |
| `cairn check`                             | Check summaries + links; exit 1 on any problem                             |
| `cairn check --summaries-only`            | Check only summary freshness                                               |
| `cairn check --links-only`                | Check only Markdown links                                                  |
| `cairn check --links-only --fix`          | Auto-repair unambiguous dead links                                         |
| `cairn check --summaries-only --stamp`    | Rewrite the `.cairn/` sidecar hash of existing summaries, bottom-up        |
| `cairn check --prune`                     | Delete orphan summaries and orphan `.cairn/` sidecars                      |
| `cairn check --migrate-stamps`            | Optional: same self-healing `--stamp` already does, as its own named step  |
| `cairn check --refs --stamp`              | Opt-in: record each real reference target's content hash                   |
| `cairn check --refs`                      | Opt-in: report references whose target content has drifted since           |
| `cairn check --prose-refs`                | Opt-in, migration aid: flag a drifted bare-backtick file citation in prose |
| `cairn init --agent claude\|copilot\|all` | Scaffold agent guidance files                                              |

### Link checking

A dead link is only the most obvious way a reference rots. `cairn check` (or
`--links-only`) verifies, for every relative Markdown link:

- **The path resolves** — including targets _outside_ your configured `roots`, as long as
  they stay inside the repository checkout (e.g. a doc in `docs/` linking to `../src/foo.ts`).
  Nothing outside the checkout root is ever touched, even to check existence — this bound is
  deliberate: CI runs over untrusted PR content, and an unbounded filesystem check would be
  an existence oracle.
- **The `#heading` fragment exists** — same-page (`[intro](#getting-started)`) and
  cross-file (`[intro](./guide.md#getting-started)`), slugged the same way GitHub does.
- **A `#L10`/`#L10-L20` line-fragment is in range**, for links to source files outside `roots`.

A broken heading or out-of-range line reports with the reason (`path` / `anchor` / `line`)
and, where possible, what's actually there (the target's real headings, or its real line
count) — so fixing it doesn't require opening the target file first.

`cairn check --refs` is a separate, **opt-in** signal, off by default and not part of the
`path`/`anchor`/`line` checks above: it tracks the _content_ of what a link points to, not
just whether the link resolves. `--refs --stamp` records a hash of every reference target;
a later `--refs` run reports any that changed since — "this doc's claim about that file may
be stale," distinct from a broken link (the link still resolves; what it once meant may not
still hold). Still v1/experimental (whole-file hashing only — a one-line unrelated change to
a large target file is reported the same as a change to the exact part being referenced).

### Prose file citations: `--prose-refs`

Docs often cite a source file inline in backticks, with no `[text](path)` syntax at all — e.g.
"see `` `src/services/auth.ts` `` for the implementation." Neither the link checker above nor
anything else notices when that file moves or is renamed; the citation just quietly goes stale.

`cairn check --prose-refs` is a separate, **opt-in migration aid** — not a permanent second
link checker. A citation that still resolves is **always silent**: no noise on ordinary prose,
full stop. Only a citation that has genuinely drifted (moved, renamed, or deleted) is reported,
and the message doesn't just say "broken" — it names the exact Markdown link syntax that would
make the reference structurally checkable going forward:

```
✗ `src/services/gone.ts` (no longer resolves) → consider a link: [`src/services/gone.ts`](../src/services/gone.ts)
```

Candidates are read rooted at the repository checkout root (like `src/services/auth.ts`, not
relative to the doc's own directory), bounded by the same checkout-root security guarantee as
the link checker above — nothing outside it is ever touched, even to check existence. Common
non-references are filtered out automatically: bare words with no path segment
(`package.json`, `.env`), glob/template-shaped strings, `./`/`../`-relative text (a different
addressing convention, not a "rooted" citation), bare directory mentions (`core/`), and
anything whose first path segment doesn't resolve to something real at all (e.g. an
npm-import-style string like `effect/Schema`) — verified by running this check against cairn's
own real docs, not just synthetic examples. Fenced code examples are never scanned, only inline
`` `code spans` `` in prose.

### Upgrading from an older cairn

**If you're upgrading past `0.3.0`**: link checking got stricter. Anchors and links outside
`roots` were previously accepted unconditionally, whether or not they actually resolved —
`cairn` simply never looked. If `cairn check` newly fails after upgrading, the links it's
flagging were already broken; nothing about your docs changed, only the tool's ability to
notice did. Fix the flagged link/anchor, or, if a genuine false positive (e.g. a symbol-level
anchor like `x.ts#someExport` — deliberately never checked, see the source's own scenario
notes), please open an issue.

Nothing to look up for the summary/stamp side. If a summary still carries the old in-content
`<!-- source-sha256: ... -->` comment, the ordinary `--stamp` command strips it and
writes the `.cairn/` sidecar in the same run — automatically, every time. There is no
separate migration step to discover: whatever `stampCommand` your repo already runs
already handles it. `--migrate-stamps` exists only as an optional, explicitly-named
alias for the same behavior, for anyone who wants the cleanup reported as its own step.

## The two summary kinds

**File summaries** — every Markdown file longer than the threshold (default 30 lines) gets
a sibling `X.summary.md`: a fast-to-read digest of the **current** content of `X.md`.
Front-load the thesis and the numbers; a reader should get the gist in ~10 seconds.

**Directory summaries** — every directory in scope gets a `_SUMMARY.md` that acts as a map.
It aggregates its direct docs (each doc's `.summary.md` if the doc is big, else the doc
itself) plus the `_SUMMARY.md` of each direct sub-directory, and it links to **every**
direct child file and sub-directory (the link-completeness rule).

### Why bottom-up

A directory summary's hash is computed over a manifest of its children's hashes — a Merkle
tree. So summaries must be (re)written and stamped **leaves-first**: file summaries, then
directories deepest-first, then stamp. Stamp top-down and parents capture stale child
hashes. The `--stamp` command walks the tree in the right order for you.

## Configuration

Drop a `.cairnrc.json` at the repo root (`cairn init` scaffolds one for you):

```json
{
  "$schema": "./node_modules/@sledorze/cairn/schema/cairn.schema.json",
  "roots": ["docs/**"],
  "thresholdLines": 30,
  "naming": {
    "dirSummary": "_SUMMARY.md",
    "fileSummarySuffix": ".summary.md"
  },
  "checks": { "summaries": true, "links": true },
  "requireDirSummaries": true,
  "ignore": ["**/node_modules/**"],
  "stampCommand": "npx cairn check --summaries-only --stamp",
  "locale": "en"
}
```

| Key                        | Meaning                                                                                 |
| -------------------------- | --------------------------------------------------------------------------------------- |
| `$schema`                  | JSON Schema URL for editor autocomplete/validation. Ignored by cairn.                   |
| `extends`                  | One or more config files to inherit from (see below)                                    |
| `roots`                    | Documentation roots to scan (array; globs allowed). Default `docs/`                     |
| `thresholdLines`           | Line count above which a file needs a `.summary.md`. Non-negative integer. Default `30` |
| `naming.dirSummary`        | Directory summary filename. Default `_SUMMARY.md`                                       |
| `naming.fileSummarySuffix` | Suffix for file summaries. Default `.summary.md`                                        |
| `checks.summaries`         | Enable summary freshness checking                                                       |
| `checks.links`             | Enable Markdown link checking                                                           |
| `requireDirSummaries`      | Require a `_SUMMARY.md` in every in-scope directory                                     |
| `ignore`                   | Globs to exclude from scanning                                                          |
| `onlyGitTracked`           | Restrict scanning to `git ls-files`-tracked/staged paths (CI parity). Default `false`   |
| `stampCommand`             | Command agents should run to stamp hashes                                               |
| `locale`                   | Prose locale for generated guidance: `en` or `fr`                                       |

Config is validated strictly (via `effect/Schema`): an **unknown key or a wrong-typed
value fails loudly** with a file-scoped, actionable error, instead of being silently
ignored. A typo like `"thresholdLins"` is a bug you want caught, not a setting that
quietly reverts to the default.

### CI parity: `onlyGitTracked`

`cairn check` normally scans whatever matches `roots`/`ignore` **on disk**, regardless of
git state — so a local run can see files a fresh CI checkout never would (an in-progress,
not-yet-`git add`-ed doc), or resolve a link against a target file that only exists
locally. Set `"onlyGitTracked": true` to restrict both the doc-scanning universe AND
link-target existence checks to `git ls-files`' tracked-or-staged set (the index, not
just the last commit) — an untracked doc is skipped entirely (no "missing summary"), and
a link to an untracked file reports broken even if the file is sitting right there on
disk, matching exactly what CI would see. Default `false` (unchanged, glob-only
behavior); when enabled, a missing/unavailable `git` binary is a hard error, never a
silent fallback to "check everything" or "check nothing."

### Sharing config with `extends`

A `.cairnrc.json` (or any file it extends) can inherit from one or more base presets:

```json
{ "extends": "./base.cairnrc.json", "thresholdLines": 50 }
```

`extends` accepts a single path or an array; presets are applied first (in order), then
the extending file's own fields win. Use it to share a base config across packages in a
monorepo, or to publish an org-wide preset as its own package.

### Editor autocomplete

The `$schema` key (scaffolded by `cairn init`, generated from the same schema that
validates your config — see `schema/cairn.schema.json`) gives editors that understand
JSON Schema (VS Code, JetBrains, coc-json) inline docs, autocomplete, and a squiggle on
an invalid key — before you even run `cairn check`.

## Multi-agent guidance

```sh
npx cairn init --agent all
```

`init` scaffolds the convention into whatever coding agents you use, so they follow it
automatically:

- **`.claude/rules/*.md`** — a path-scoped Claude rule (`paths:` frontmatter) loaded when an
  agent touches your docs.
- **`CLAUDE.md`** — an `@AGENTS.md` import, upserted at the repo root. Claude Code
  auto-loads `CLAUDE.md` at session start but never reads `AGENTS.md` on its own; without
  this pointer the block below is invisible to it.
- **`.github/instructions/*.instructions.md`** — GitHub Copilot instructions with an
  `applyTo:` glob.
- **`AGENTS.md`** — a block appended to the repo-wide agent guide.
- **`SKILL.md`** — the on-demand methodology for _writing good summaries_.

Pass `--agent claude`, `--agent copilot`, or `--agent all`.

## CI usage

Run the check as a required status. It is fast and clone-safe by design:

```yaml
- run: pnpm add -D @sledorze/cairn
- run: npx cairn check
```

A missing, stale, or broken summary exits non-zero and blocks the merge. Because freshness
is content-hashed rather than mtime-based, the result is identical to what you saw locally —
no false greens after checkout.

## Credits

Built on [Effect](https://effect.website).
