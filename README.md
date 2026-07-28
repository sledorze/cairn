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

The `cairn` CLI is fully bundled and needs nothing else. The programmatic API
(`import { ... } from '@sledorze/cairn'`) additionally needs `effect` and
`github-slugger`, declared as optional peer dependencies — install them yourself if you
use that entrypoint: `pnpm add effect github-slugger`.

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

`--fix` auto-repairs a broken anchor too, when it differs from a real heading (or explicit
`<a id="...">` anchor) by case alone — an unambiguous, exact match, never a fuzzy guess (a
wrong-but-similar match would confidently point the link at the WRONG heading, which is worse
than leaving it broken). Two anchors that case-collide, or no match at all, are left unchanged
and still reported.

A single unreadable file never crashes the whole run: a broken symlink or a permission-denied
subdirectory encountered while scanning is silently excluded from that scan (matching how any
other non-file entry is treated), while a scan root you explicitly configured still fails
loudly if it can't be read at all. A permission-denied doc file, specifically for
`cairn check`/`--links-only`, is reported explicitly rather than silently skipped: it's listed
by path in a new `unreadable` array on the result (also present in `--json` output) and makes
the run exit non-zero, same as a broken link would. `--summaries-only`, `--refs`, and
`--prose-refs` skip an unreadable doc without crashing too, though without that same explicit
`unreadable` reporting — for `--summaries-only` specifically, an unreadable-but-existing
summary currently reads as `missing` rather than distinctly `unreadable`.

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

### Structural coverage/orphans: `checks.coverage`

For docs beyond code reference (PRDs, feature specs, requirements, decision logs): a green
`cairn check` today says every summary is fresh and every link resolves — it says nothing
about whether the docs are actually _related_ the way they need to be. A repo can have 40
feature docs and 12 decision docs, zero links between them, and still be fully green.
"Reachability is not coverage."

`checks.coverage` is a separate, **opt-in** structural check — its mere presence in config
is the opt-in, there's no `--coverage` flag (its `kinds`/`rules` have no CLI equivalent to
express them with). Declare doc **kinds** by path glob, and **rules** — every doc of one
kind must link somewhere to a doc of another:

```json
"roots": ["docs", "product"],
"checks": {
  "coverage": {
    "kinds": [
      { "id": "feature", "select": { "by": "path", "glob": "**/product/features/**" } },
      { "id": "decision", "select": { "by": "path", "glob": "**/docs/adr/**" } }
    ],
    "rules": [{ "from": "feature", "to": "decision" }],
    "exempt": ["**/product/features/templates/**"]
  }
}
```

A kind's glob only classifies docs cairn already scans — it does **not** implicitly extend
`roots` (default `["docs"]`). If your feature docs live under `product/` and `roots` doesn't
include it, `checks.coverage` checks zero of them. Make sure every kind's glob falls inside a
configured root, as the example above does by adding `"product"`.

Every glob in this config — `ignore`, a kind's `select.glob`, `exempt` — is matched against
the doc's real, **absolute** filesystem path, never a path relative to `roots` or the repo
root. A leading `**/` (matching any prefix, including none) is what makes a glob like
`"**/product/features/**"` match regardless of exactly where the repo checkout lives on disk
— the same reason the default `ignore` is `"**/node_modules/**"`, not bare `"node_modules/**"`.
Omitting it (as an earlier version of this example did) silently matches nothing, ever — no
error, just a doc that's forever `unmatched`.

Three report classes, all file-level (a violation is an absence — there's no specific line to
point at) except the third, which is a warning about the config itself:

- **missing coverage** — a `feature` doc with no outbound link to any `decision` doc.
- **orphan** — a `decision` doc (a kind that's actually supposed to be linked TO, per some
  rule's `to` side) with zero inbound references from _anywhere_ in the scanned corpus. A
  kind that only ever _initiates_ relations (like `feature` here) is never itself checked
  for orphan status — nothing expects anything to link back to a feature.
- **unmatched kind** (⚠️, never fails the build) — a declared kind that matched zero scanned
  docs, e.g. because its glob falls outside `roots` or is simply mistyped. Without this, that
  mistake is invisible: `"✅ Coverage OK (0 doc(s) checked)"` looks identical to genuine
  success. Non-fatal because a kind can legitimately have zero docs yet (mid-rollout) — it's
  a hint to check your config, not a rule violation.

`exempt` (globs) opts a doc out of both missing-coverage and orphan reporting entirely — not
orphan status alone, so an intentionally unlinked template doc isn't flagged for lacking
outbound links either. The same escape hatch Sphinx's `:orphan:` marker and MkDocs'
`not_in_nav` needed to keep their own equivalent checks tolerable in practice.

Two rules can share the same `kinds` pair but mean different things — e.g. a spec both
`implements` a decision and is `verified_by` one. Give each an optional `name` to keep them
distinct obligations (both checked, both reported separately); two rules on the same pair
with no name, or the same name, are treated as one:

```json
"rules": [
  { "from": "spec", "to": "decision", "name": "implements" },
  { "from": "spec", "to": "decision", "name": "verified_by" }
]
```

Every rule's `from`/`to` must name a kind id declared in `kinds` — config decode rejects a
typo (e.g. `"decisionn"`) up front, rather than silently, permanently reporting every
`from`-kind doc as missing coverage because nothing could ever satisfy it.

A rule also has an optional `via`, naming _how_ it's satisfied — `{ "by": "link" }` (a direct
outbound reference) is both the only implemented value and the implicit default when `via` is
omitted, so existing configs need no change. It exists so a future requirement type (a
minimum link count, a required backlink, a heading-scoped reference) is a new `by` value, not
a breaking change to every rule already written:

```json
{ "from": "feature", "to": "decision", "via": { "by": "link" } }
```

Reuses the same link-extraction the checks above already do — **no new Markdown syntax to
author**, just the links you'd write anyway. Current scope, deliberately: classification is
path-glob only (no frontmatter-based kind selector yet), and coverage is checked by a
direct link only — a chain `feature → decision → spec` does **not** by itself satisfy a
direct `feature → spec` rule (matches how requirements-traceability tooling treats a trace
link: real evidence, not an inference).

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

**If you're upgrading past `0.4.0`**: `cairn check --fix` now also auto-repairs a broken
heading anchor (same-page and cross-file), not just a broken path — see "Broken-link
auto-repair" above. This is a behavior change on the **existing** `--fix` flag, not a new
opt-in one: if you already run `--fix` unattended in CI or a pre-commit hook expecting it to
touch only link paths, it may now also rewrite an anchor fragment it can unambiguously
match by case. The repair is narrow (exact case-insensitive match only, never fuzzy; an
ambiguous or unmatched anchor is left alone and still reported), but review the diff on your
first post-upgrade `--fix` run if that distinction matters to you.

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

| Key                        | Meaning                                                                                                                                                                                                                                                                            |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `$schema`                  | JSON Schema URL for editor autocomplete/validation. Ignored by cairn.                                                                                                                                                                                                              |
| `extends`                  | One or more config files to inherit from (see below)                                                                                                                                                                                                                               |
| `roots`                    | Documentation roots to scan (array; globs allowed). Default `docs/`                                                                                                                                                                                                                |
| `thresholdLines`           | Line count above which a file needs a `.summary.md`. Non-negative integer. Default `30`                                                                                                                                                                                            |
| `naming.dirSummary`        | Directory summary filename. Default `_SUMMARY.md`                                                                                                                                                                                                                                  |
| `naming.fileSummarySuffix` | Suffix for file summaries. Default `.summary.md`                                                                                                                                                                                                                                   |
| `checks.summaries`         | Enable summary freshness checking                                                                                                                                                                                                                                                  |
| `checks.links`             | Enable Markdown link checking                                                                                                                                                                                                                                                      |
| `checks.coverage`          | Opt-in structural coverage/orphan check (see below). Absent by default — presence enables it, no separate flag                                                                                                                                                                     |
| `requireDirSummaries`      | Require a `_SUMMARY.md` in every in-scope directory                                                                                                                                                                                                                                |
| `ignore`                   | Globs to exclude from scanning — a directory-shaped match is pruned before it's ever walked, not just filtered out afterward (issue #63). `.gitignore` is also consulted automatically for the same directory-level pruning, with no config needed, regardless of `onlyGitTracked` |
| `onlyGitTracked`           | Restrict scanning to `git ls-files`-tracked/staged paths (CI parity). Default `false`                                                                                                                                                                                              |
| `stampCommand`             | Command agents should run to stamp hashes                                                                                                                                                                                                                                          |
| `locale`                   | Prose locale for generated guidance: `en` or `fr`                                                                                                                                                                                                                                  |

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
