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

`cairn` checks **content**, not clocks. Each summary embeds the SHA-256 of the
source it summarizes as its first line:

```markdown
<!-- source-sha256: 3f9a…(64 hex) -->
```

The checker recomputes the source hash and compares. Mismatch means stale, missing means
missing — and it behaves identically on your laptop and in CI, before and after a clone.

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
   stamp in `guide.summary.md`.
3. **Write** the updated `guide.summary.md` (and update any parent `_SUMMARY.md`).
4. **Stamp**: `npx cairn check --summaries-only --stamp` rewrites the
   `source-sha256` lines bottom-up.
5. **Check** again — `npx cairn check` exits 0. Green.

You author the prose; the tool verifies and stamps. It never invents content.

### Commands

| Command                                   | What it does                                             |
| ----------------------------------------- | -------------------------------------------------------- |
| `cairn check`                             | Check summaries + links; exit 1 on any problem           |
| `cairn check --summaries-only`            | Check only summary freshness                             |
| `cairn check --links-only`                | Check only Markdown links                                |
| `cairn check --links-only --fix`          | Auto-repair unambiguous dead links                       |
| `cairn check --summaries-only --stamp`    | Rewrite `source-sha256` of existing summaries, bottom-up |
| `cairn init --agent claude\|copilot\|all` | Scaffold agent guidance files                            |

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

| Key                        | Meaning                                                               |
| -------------------------- | --------------------------------------------------------------------- |
| `$schema`                  | JSON Schema URL for editor autocomplete/validation. Ignored by cairn. |
| `extends`                  | One or more config files to inherit from (see below)                  |
| `roots`                    | Documentation roots to scan (array; globs allowed). Default `docs/`   |
| `thresholdLines`           | Line count above which a file needs a `.summary.md`. Default `30`     |
| `naming.dirSummary`        | Directory summary filename. Default `_SUMMARY.md`                     |
| `naming.fileSummarySuffix` | Suffix for file summaries. Default `.summary.md`                      |
| `checks.summaries`         | Enable summary freshness checking                                     |
| `checks.links`             | Enable Markdown link checking                                         |
| `requireDirSummaries`      | Require a `_SUMMARY.md` in every in-scope directory                   |
| `ignore`                   | Globs to exclude from scanning                                        |
| `stampCommand`             | Command agents should run to stamp hashes                             |
| `locale`                   | Prose locale for generated guidance: `en` or `fr`                     |

Config is validated strictly (via `effect/Schema`): an **unknown key or a wrong-typed
value fails loudly** with a file-scoped, actionable error, instead of being silently
ignored. A typo like `"thresholdLins"` is a bug you want caught, not a setting that
quietly reverts to the default.

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
