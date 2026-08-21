# @sledorze/cairn

## 0.14.0

### Minor Changes

- c95a808: `cairn check` now prints a one-time notice — `cairn 0.9.0 → 0.10.0 — see this package's own
CHANGELOG.md for what changed (config keys and conventions rarely show up in --help).` —
  whenever the running cairn version differs from the one this repo was last stamped with.
  Closes issue #155: most releases add config keys and Markdown conventions
  (`checks.coverage.kinds`, `refs.scope`, `cairn-refs` fenced blocks, ...), deliberately
  invisible in `--help` — so nothing routed a reader to the one place that actually explains
  what changed, `CHANGELOG.md`, which already ships in the package (issue #134). Confirmed
  real via two independent upgrade experiences reported on the issue, one spanning 7 minor
  versions with zero signal either way.

  Read-only on a plain `cairn check` — the notice repeats every run, same as any other
  reported drift, until the next `cairn check --stamp` (any stamp mode: bare `--stamp`,
  `--summaries-only --stamp`, `--refs --stamp`, `--migrate-stamps`) records the current
  version to a new, single, repo-level `.cairn/version.json` sidecar and silences it. A
  repo's very first `--stamp` ever (no prior sidecar) records the version silently, with no
  notice — there's no previous version to compare against, so it isn't an upgrade signal.
  Suppressed under `--json`, same as every other human-readable line.

## 0.13.2

### Patch Changes

- d25a7f6: `cairn check --refs`'s "Tip: configure checks.coverage.kinds..." discoverability hint now
  respects `checks.coverage: false` — a repo that considered `checks.coverage.kinds` and
  explicitly declined it (already a real, schema-supported value, same as every other opt-in
  structure check here) no longer gets nagged on every single stale-refs report forever. Before
  this, `resolved.checks.coverage` collapsed BOTH "never configured" and "explicitly declined"
  to the same `null`, so there was no config-level way to silence it. New resolved field
  `ChecksConfig.coverageExplicitlyDisabled` carries the distinction through; no new config
  syntax, no schema change — reuses the existing `false` value.

  README also corrects a factual error in `0.13.1`'s own peer-floor reasoning: it claimed
  "this package has no runtime dependency on effect itself" as a blanket statement, when that's
  only true for the bundled CLI. The programmatic API (`import { ... } from '@sledorze/cairn'`)
  keeps real, unbundled `effect` imports and genuinely loads the consumer's installed copy at
  runtime — confirmed by tracing real module resolution in a fresh pnpm sandbox
  (`.pnpm/effect@.../node_modules/effect/package.json` actually opened). So for that entrypoint
  an incompatible `effect` below the stated floor is a live compatibility surface, not an
  untestable one — the opposite of what the prior wording implied.

  Both prompted by a real REX (cairn#190).

## 0.13.1

### Patch Changes

- e163521: README clarifies that the `effect` peer dependency floor is a testing boundary, not a
  verified compatibility one: it's the oldest version this package's own CI runs against, not
  necessarily the oldest that actually works. Prompted by a real REX (cairn#187): under npm the
  stated floor is a hard `ERESOLVE` if unmet; under pnpm's default (looser) peer resolution, an
  older `effect` still installs and runs without complaint — this package has no runtime
  dependency on `effect` itself (it's a peer, and the CLI is fully bundled), so nothing here can
  currently tell those two cases apart for you.

## 0.13.0

### Minor Changes

- e8bc001: Bumps the `effect` peer dependency floor to `^4.0.0-rc.109` (from `^4.0.0-beta.100`) — a
  real, narrow break in `effect` itself between those two prereleases: `SchemaError` moved
  from its own top-level `effect` export to living inside `Schema` instead (`Schema.SchemaError`),
  confirmed directly against both versions' own shipped type declarations, not assumed. The
  previous peer range claimed compatibility with `beta.100` that this package's own CI no
  longer actually tests against.

  Also fixes a real bug this bump surfaced in the shipped `schema/cairn.schema.json`:
  `JsonSchema.META_SCHEMA_URI_DRAFT_07` now already includes its own trailing `#` (a separate,
  undocumented change in `effect`), and `scripts/generate-schema.ts` was still appending
  another one — producing a malformed `"$schema": "...schema##"` URI in the generated/shipped
  schema file. Fixed to use the constant directly.

  Known, non-blocking, disclosed rather than silently left implicit: `@effect/platform-node`'s
  own peer dependency swapped from `ioredis` to `redis` between these versions (unrelated to
  anything cairn itself uses — it has no Redis-backed platform service — but a real change in
  the installed dependency tree, not just cairn's own code); and a transitive peer
  (`@effect/platform-node-shared`, pulled in by `@effect/platform-node`) wants `effect@^4.0.0-rc.111`
  while this repo pins `effect@4.0.0-rc.109` — tolerated by pnpm's default non-strict peer
  resolution today, not yet closed, since bumping further to `rc.111` surfaced new, unrelated
  CLI-integration-test breakage outside this change's own scope (a real behavioral regression
  between `rc.109` and `rc.111`, not investigated here).

## 0.12.0

> **Never actually published to npm** — this version's own release run hard-failed (the
> `changesets/action` v2 `publish`→`publish-script` input rename, fixed by #182, which landed
> only after this version had already been bumped); the next successful publish shipped
> directly as `0.13.0` without republishing this one. `npm view @sledorze/cairn@0.12.0` 404s.
> Kept here, unedited otherwise, for historical accuracy — every feature below is real and
> shipped, just first installable from `0.13.0` onward (see cairn#187).

### Minor Changes

- 47584ab: New `cairn check --changed <path...>` flag (repeatable, relative-to-cwd or absolute):
  when `checks.coverage` is configured, scopes its report to just the rule edges touching
  those paths — as a rule's own `from` doc, or as a doc some other rule's edge resolved to
  (a `satisfiedBy` target) — and prints each matching rule's own `description` as guidance
  instead of the full corpus report: "if this file changed, here's what a reviewer should
  re-check, and why." Aimed at AI-review tooling that already knows which files a diff
  touched and wants targeted guidance rather than the whole coverage report.

  The exit code stays corpus-wide even under `--changed` — it never narrows to just the
  scoped edges, so a real problem in an untouched file still fails the build exactly like
  running without the flag. Every cause of that non-zero exit is disclosed by the scoped
  report itself, one of two ways: an unsatisfied rule that's IN scope shows up directly in
  the printed edge list, marked "NOT satisfied"; anything NOT shown there — an unsatisfied
  rule outside scope, or any orphan doc at all (orphans are per-doc facts, never rendered
  by this report regardless of scope) — is counted in an explicit "N other coverage
  issue(s) not shown above" line. Deliberately scope-neutral wording: an orphan's own
  path can itself be one of the changed paths, so a location claim like "outside the
  changed path(s)" would sometimes be false.

  No effect on any other check, and no effect at all when `checks.coverage` isn't
  configured or `--changed` isn't passed — purely additive.

- 47584ab: `checks.coverage` reports (both the ordinary `missing` report and the `--changed`-scoped
  guidance report) now print a single, automatic disclaimer — "Coverage only confirms these
  links exist — it does not check the linked content's substance..." — whenever at least one
  shown rule carries a `description`. Printed at most once per report, never once per entry,
  and never for an orphans-only report (orphans are per-doc facts, not tied to any rule's
  `description`). Exists because `checks.coverage` only ever verifies a link's existence, never
  judges the linked content — a rule's own `description` names a way a link could be hollow,
  but that's guidance for a reviewer, not something the tool itself checks.

  Also: README.md and `docs/design/CONVENTION.md` gained a concise brief on writing a good
  rule `description` — state which doc makes the claim and which is its evidence (direction),
  and name one concrete, relationship-specific way a link could be technically present but
  hollow, rather than a generic "make sure it's good" or a per-rule repeat of what the new
  disclaimer already says. `cairn init --agent claude`'s scaffolded design-package skill
  (`DESIGN_PACKAGE_SKILL_BODY`) carries the same brief and revised example rule descriptions,
  so a library consumer adopting that scaffold sees the same guidance, not just this repo's own
  polished config.

- a5c3c0a: New opt-in check: `checks.storyMapTiers.globs` — enforces a real story-mapping invariant
  (Jeff Patton's "walking skeleton": exactly one `(Must)`-tagged card per backbone step, the
  thinnest slice that works end-to-end) against `## Cards, by backbone step` sections in any
  doc matching the configured globs. A step with zero, or more than one, `(Must)`-tagged card
  is reported as a violation — the same class of drift a doc can silently accumulate when it
  claims a walking skeleton in prose but nothing structurally marks one.

  Opt-in via config presence, no CLI flag — same idiom as `checks.freshness`/
  `checks.docCoverage`. Rejects `--json` (`jsonUnsupportedMessage`), same as every other
  structure check today.

  Deliberately narrow: pure intra-document structural census (headings + a `(Must|Should|
Could)` tag regex, masking fenced code first so a doc's own syntax example is never
  miscounted) — not a general claims/predicate-checking engine. That larger idea was
  investigated separately (`docs/design/137-typed-relations/`) and correctly declined for lack
  of evidence; this check doesn't reopen that decision, it solves a narrower, already-real need
  in a different shape (no code-target resolution, no comparison predicates).

### Patch Changes

- 6947fea: Fixes a false green in `cairn check --links-only` (and every check built on `stripCode`):
  an inline code span (`` `code` ``) wrapped across a line break, followed by at least one more
  backtick on the closing line, could silently swallow a real Markdown link — the link was
  never reported, even when its target didn't exist. The old inline-code masking paired
  backticks per LINE, losing the span's open/closed state across the line break; a wrapped
  span's true closer was invisible to it, so the scan re-paired the OPENING backtick against
  whatever came next on the CLOSING line instead, blanking out everything between — including
  a real `[text](target)` link.

  Fixed by masking inline code spans across the whole document, matching CommonMark's actual
  rule (a span is delimited by a backtick RUN, closing at the next run of equal length,
  wherever it falls — no same-line restriction) instead of a single-line regex. Wrapping a
  code span across a line break is ordinary Markdown reflow and must not change link
  extraction, whether the link comes from `--links-only`'s own dead-link report,
  `checks.coverage`, `checks.docCoverage`, `checks.storyMapTiers`, or any other check built on
  the same shared `stripCode` primitive.

## 0.11.1

### Patch Changes

- d3e2c10: `cairn check --summaries-only --explain`'s real git line-count delta (added in a prior
  minor) now prints immediately below the expected/recorded hash pair for a stale file
  summary, instead of below the source's full heading outline. On a large doc the delta
  — the actual answer to "is this a real content change or a reflex re-stamp?" — used to
  land 20+ lines below the question; it's now adjacent to it. Pure reordering: the
  outline itself still always prints in full, for both `missing` and `stale` nodes — a
  stale summary has to be rewritten, and the outline is exactly the source's current
  section shape that a rewrite is done against (issue #162, item #2; the outline was
  suppressed for stale nodes in an earlier version of this fix, then withdrawn after
  further review of that issue for that same reason).
- d33c963: `cairn check --refs`'s stale-reference report now points its "Fix:" hint at a new,
  dedicated `refsStampCommand` config field (default `npx cairn check --refs --stamp`)
  instead of a hardcoded guess. Previously the hint always suggested `pnpm run stamp:refs`
  as a fallback regardless of whether that script actually existed in the repo, and never
  read the repo's own configured stamp command the way the summaries report already reads
  `stampCommand` — so a repo whose real ref-stamping command needed a formatter step first
  (or used a different script name) got a hint that either didn't work or reproduced a
  stale-summary trap it had already configured its way out of. `refsStampCommand` is
  deliberately a separate field from `stampCommand`, not a reuse of it: `stampCommand` is
  conventionally scoped to summary freshness (commonly `--summaries-only`, as this repo's
  own config does) and does not stamp `--refs` sidecars at all (issue #162, item #1).

## 0.11.0

### Minor Changes

- bd13609: `cairn check --summaries-only --explain` now shows a real git line-count delta for a stale file summary (e.g. `changed since 029d0f0e…: +3/-0 lines`) instead of only the source's current outline — the "reflexive re-stamping" gap (issues #101/#142/#154): a bare hash mismatch says nothing about _what_ changed, so a human or agent re-stamps without looking. Best-effort only: silently falls back to today's output when there's no git repo, the recorded hash predates the file's available history, or the change is binary. Bounded on both axes — at most 50 past commits walked per doc, and at most 20 stale docs enriched per `--explain` run — so a large repo with many stale docs can't make this slow; later docs simply show without a diff line. No effect on `check`'s exit code, on non-`--explain` output, or when git is unavailable — purely additive.

### Patch Changes

- 371fbdc: `cairn check --summaries-only` now tells a legacy in-content `<!-- source-sha256: ... -->` stamp (pre-`.cairn/` sidecar format) apart from genuine content drift. Previously both showed the same generic `stale (source changed)`, which reads as alarming, undifferentiated mass drift on a repo upgrading off the old format — the actual fix (`--migrate-stamps`, or an ordinary self-healing `--stamp`) wasn't discoverable at the point of failure. Affected summaries now report `legacy inline stamp (format migration, not drift)`, and the report ends with a line pointing straight at `cairn check --summaries-only --migrate-stamps`. No behavior change to what's stale/missing or to exit codes — output only (issue #142, item #1).

## 0.10.0

### Minor Changes

- 6b88594: `cairn check --refs`'s stale-reference report can now show WHY a citation matters, not just
  that it changed — when `checks.coverage.kinds` is also configured, each stale entry gets its
  citing doc's kind description (and, when the target is itself a `.md` file, the target's
  kind description too) as review context, reusing that field's existing, already-mandatory
  role — no new config surface.

  Dogfooded live against this repo's own `docs/adr`/`docs/design` cross-references before
  shipping: real drift on a doc cited by 6 sibling docs surfaced kind guidance on all 6, not a
  synthetic example.

  Absent by default — a project with no `checks.coverage.kinds` configured (or `--refs` used
  alone) behaves identically to before.

- 47ff024: `cairn check --refs`'s stale-reference report now ends with a one-time tip pointing at
  `checks.coverage.kinds` when a real stale reference exists and no kinds are configured —
  closing a real discoverability gap where the kind-aware guidance feature (#143) had zero
  signal in its own output that it existed at all, unless you'd already read the README.

  Absent on a clean run (nothing to gain guidance about) and absent once `checks.coverage` is
  configured (no nagging after opting in) — only shown when it's actually actionable.

- d4b1484: `--prose-refs` gets a config-level escape hatch and a more honest report: `checks.proseRefs.ignore`
  (an array of exact citation text, or a glob over it) exempts a backticked prose citation from ever
  being checked — for a doc that documents a path FORMAT (a sample-path table, a prose example naming
  a fictitious filename) rather than citing a real file, which previously had no way to avoid being
  flagged as broken.

  ```json
  "checks": {
    "proseRefs": { "ignore": ["src/a.ts", "examples/*.ts"] }
  }
  ```

  Absent by default (no ignore list) — existing configs are unaffected. This doesn't enable
  `--prose-refs`; the CLI flag still does that, this only tunes it.

  Also: the report wording changed from "no longer resolves" to "does not resolve" (and the summary
  line from "drifted" to "broken"). `--prose-refs` is a live, stateless existence check with no
  history of a citation's target — it cannot tell a citation that was genuinely moved or deleted from
  one that was never real (a typo, an illustrative example), so the prior wording implied a certainty
  the check never had.

- 64ad856: `cairn check --refs`/`--stamp` can now track a doc's claim about a file it has no reason to
  hyperlink. A fenced block tagged `cairn-refs` declares extra targets — one path (optionally
  `path#anchor`) per line — tracked exactly like a real link's target: same content hash, same
  drift report, same `--stamp`. Closes the gap where a doc's claim about, say,
  `package.json#files` had no way to be tracked at all, since nothing in the sentence was a
  `[text](path)` link (issue #130).

  Absent by default — a doc with no `cairn-refs` block behaves identically to before. No new
  config surface.

- e1c0d9a: `cairn check --refs`/`--stamp` gains its first config-level knob: `refs.scope`, a list of
  `{ glob, unit }` groups (`unit: "whole-file"` (default, unchanged) | `"ignore"`) deciding how
  finely a reference target's content is hashed. First matching glob (array order) wins; no
  match keeps today's only behavior.

  Closes issue #101: a doc citing a noisy file it merely mentions in passing used to fail
  `--refs` on every unrelated edit to that file. Give that glob `unit: "ignore"` and it's
  exempted from hashing entirely — no facade-file restructure needed to work around it.

  Absent by default — a project with no `refs.scope` behaves identically to before. ADR 0004
  Release 1 (`docs/adr/0004-refs-scoped-hashing-granularity.md`); `unit: "exports-only"`
  (hashing a file's exported surface, not its full bytes) is a separate, not-yet-built release.

### Patch Changes

- a3f4a48: A plain `cairn check` failure now ends with a one-line pointer to `--explain` when there's a
  stale or missing summary to explain (`Tip: run with --explain to see why each summary above is
stale or missing.`). Previously the flag existed but the failure output never mentioned it, so
  discovering it required already knowing to look for it. The hint never appears on `--explain`
  runs themselves, on a clean run, or on an orphans-only failure (nothing in `--explain`'s scope
  to explain there).
- 9fda67f: Packaging fix: `CHANGELOG.md` is now included in the published npm tarball (`files` in
  `package.json`) — previously it was generated on every release but never shipped, so
  upgrading consumers had no in-package way to see what changed.

  Docs fixes: README's `cairn init --agent` documentation now lists all 5 real values
  (`claude`, `copilot`, `agents`, `opencode`, `all` — `agents`/`opencode` were previously
  missing from both the command table and the prose), and README now documents that `--json`
  cannot be combined with `--stamp`, `--migrate-stamps`, `--report-deletions`, `--refs`,
  `--prose-refs`, `checks.coverage`, `checks.docCoverage`, or `checks.freshness` (each errors
  out explicitly rather than silently ignoring a flag).

- cd62522: `cairn init`'s scaffolded onboarding docs (`AGENTS.md`, `.claude/skills/cairn/SKILL.md`,
  `.claude/rules/docs-summaries.md`, `.github/instructions/docs-summaries.instructions.md`)
  and `cairn init`'s own printed "Next:" hint no longer hardcode
  `npx cairn check --summaries-only --stamp` as the literal next-step instruction — they now
  point at the repo's configured `stampCommand` instead (`cli.ts`'s hint reads it live from
  config; the scaffolded docs reference it generically).

  Found by adversarial review: a repo that customizes `stampCommand` (e.g. to format before
  stamping) ends up with scaffolded onboarding docs that keep telling readers to run the old
  default forever, since the scaffold is a one-time snapshot, not re-synced on config
  changes. This repo hit it on itself the moment it customized its own `stampCommand` — a
  second adversarial pass then found the first fix only reached 2 of 5 affected files, plus
  `cli.ts`'s own printed hint; this closes all of them and adds a regression test tight
  enough to reject a decoy wording that mentions `stampCommand` without actually using it as
  the run instruction.

## 0.9.0

### Minor Changes

- 101c0ea: Added `checks.freshness`, a new opt-in check: a doc whose real git history (committer date of
  its last real commit, not filesystem mtime) is older than its own matching rule's `maxAgeDays`
  is reported stale.

  ```json
  "checks": {
    "freshness": {
      "rules": [{ "glob": "docs/adr/**", "maxAgeDays": 365 }]
    }
  }
  ```

  `rules` is an ordered array of `{ glob, maxAgeDays }`; the FIRST rule (declared order) whose
  glob matches a doc's path applies, and a doc matching none is skipped entirely (not reported,
  not counted). A doc with no commit history yet is silently excluded from staleness reporting —
  nothing to measure an age from. Absent by default — presence enables it, matching
  `checks.docCoverage`'s own opt-in shape. Existing configs are unaffected.

- 101c0ea: `checks.coverage`'s rule `description` field is now **mandatory whenever a rule has a
  `name`** — enforced at config decode time, alongside the existing undeclared-kind check. A
  named rule (e.g. `{ from: "spec", name: "implements", to: "decision" }`) with no
  `description` will now fail to decode entirely, not just produce a config warning.

  This is a real, stricter check, not just a bugfix — if you already use `checks.coverage`
  with a named rule and no `description`, `cairn check` will start failing to even load your
  config after upgrading. Add a `description` string explaining what the relationship means
  and how to satisfy it (rendered directly in the report when the rule is unmet) to fix it. An
  unnamed rule (no `name`) is unaffected — its report line is already self-explanatory, so
  `description` stays optional there.

  Rationale: `name` alone was found to only ever feed a bare disambiguating label into the
  report — useful for telling two rules apart, but explaining nothing to a reader unfamiliar
  with the vocabulary. Making `description` mandatory exactly where that gap exists (not for
  every rule, which would just produce restated filler on already-self-explanatory rules)
  closes it by construction instead of leaving it to be remembered.

- 101c0ea: Added a third `CoverageTarget` variant to a `checks.coverage` rule's `to` field:
  `{ external: 'url', pattern: '...' }` — satisfied by a doc's outbound Markdown link whose
  raw href CONTAINS `pattern` (a plain substring match, not a regex/glob DSL). Closes a real,
  previously self-reported gap: `to` could only name a declared kind id or `{ external: 'path'
}` (a link resolving to a real file on disk), with no way to require a link to an external
  URL — e.g. every design-package `problem-space.md` must link its originating GitHub issue.

  ```json
  {
    "from": "problem-space",
    "name": "traces_to",
    "to": { "external": "url", "pattern": "https://github.com/OWNER/REPO/issues/" }
  }
  ```

  Purely additive and opt-in — an existing `checks.coverage` config (including one already
  using `{ external: 'path' }`) decodes and behaves identically with no `{ external: 'url' }`
  rule present.

- 101c0ea: `checks.coverage`'s `KindSelector` gains a second, additive variant: `{ "by": "frontmatter", "field": "status", "equals": "accepted" }` classifies a doc into a kind by matching a flat, top-level YAML frontmatter key/value pair, alongside the existing `{ "by": "path", "glob": "..." }` variant.

  Closes a real, concretely-scoped gap this repo's own ADRs (`docs/adr/*.md`) exposed while validating `checks.coverage` against a corpus outside `docs/design/`: every ADR shares one path glob, but a real structural distinction between them (e.g. `status: proposed` vs `status: accepted`) can't be expressed by path alone — only by reading each file's own frontmatter. This lets a rule like "every accepted ADR must be linked from an architecture overview doc" be expressed and enforced, which was previously inexpressible in this schema.

  Reads only a flat, top-level `key: value` frontmatter block (no nested YAML, no lists, no multi-line scalars). A doc with no frontmatter, or missing the selector's `field`, simply doesn't match that kind — never a decode error. A doc can match kinds from both selector variants at once.

  Purely additive and opt-in: an existing config using only `by: "path"` selectors decodes and behaves identically.

- 101c0ea: Added two new optional fields to a `checks.coverage` rule:

  - `scope: "sibling"` restricts rule satisfaction to a `to`-kind doc in the SAME parent
    directory as the `from` doc, instead of anywhere in the scanned corpus. Closes a real,
    verified gap: a shared, wildcard kind glob (e.g. matching every instance of a repeated
    document-package pattern) let one instance satisfy its rules by cross-linking a completely
    unrelated instance's real docs — a fully hollow "package" could pass with zero warnings by
    linking to a real sibling's content instead of writing its own. `scope: "sibling"` lets one
    small, generic, wildcard-based `kinds`/`rules` block correctly enforce structural
    completeness across many repeated instances of the same pattern (e.g. many independent
    design-doc packages under a shared parent directory) without per-instance config
    duplication, and without reopening a silent "forgot to configure a new instance" gap that
    a naive per-instance-scoped config would otherwise introduce.
  - `description` on a rule renders as a real, in-context guidance line under a
    missing-coverage report entry, alongside the existing `name` (which only ever
    disambiguates two rules sharing a `from`/`to` pair — it was never meant to explain
    anything, and didn't). Optional; omitted entirely when absent, never a blank line.

  Both fields are additive and opt-in — an existing `checks.coverage` config decodes and
  behaves identically with neither field present.

- 101c0ea: `checks.coverage`'s `scope: { under: "..." }` is now validated for real, closing a known limitation recorded in a previous release: a typo'd or out-of-corpus `under` value used to decode successfully and then silently, permanently report every rule using it as unsatisfiable, with nothing pointing at the real cause.

  `cairn check` now surfaces a non-fatal warning line for any `under` value that matches zero scanned docs of any kind:

  ```
  ⚠️  scope { under: "docs/desing/team-b" } matched 0 scanned docs of any kind — check it for a typo, that it names a directory under a configured `root`, or that no docs simply exist there yet.
  ```

  This is checked at `cairn check` run time, once the doc corpus is actually scanned — not at config-decode time, unlike a `from`/`to` kind-id typo (`roots` and `checks.coverage` can be set in different `extends` layers, so no single-layer decode can see both together). Like the existing `unmatchedKinds` warning, it never fails the build on its own (a legitimately not-yet-populated directory looks the same as a typo from this check alone) — it's a diagnostic hint, not a new violation class.

- 101c0ea: `checks.coverage`'s rule `scope` gains a second, additive option: `{ under: "some/project/relative/dir" }`. It restricts rule satisfaction to a `to`-kind doc whose resolved path is nested anywhere below the given directory — narrower than the unscoped default (satisfied by a `to`-kind doc anywhere in the scanned corpus), broader than `scope: "sibling"` (exact same parent directory only). Useful for scoping a wildcard-glob rule to a named sub-tree (e.g. one team's own `docs/design/` packages) without limiting it to a single directory or opening it to the whole corpus.

  ```json
  { "from": "roadmap", "to": "spikes", "scope": { "under": "docs/design/team-b" } }
  ```

  `scope: "sibling"` and the unscoped default keep decoding and behaving exactly as before — purely additive, no config written before this field existed changes meaning.

  `under` is rejected at config-decode time when it's empty or only slashes (`""`, `"/"`, `"///"`) — that value would otherwise collapse the matcher's `**/<under>/**` glob into one that matches every path in the corpus, a silent, vacuous "scope" indistinguishable in a report from a real, intentional one (found by adversarial review before this shipped).

  Known limitation, recorded rather than silently left implicit: `under` is otherwise a plain string with no validation against the config's own `roots` — a typo or an out-of-scope value still decodes successfully and then silently, permanently reports every rule using it as unsatisfiable, unlike a `from`/`to` kind-id typo (already rejected at decode time). See `docs/design/review-prompts.md`'s section 4 for the full finding.

- 101c0ea: `checks.coverage`'s rule `to` field now accepts an ARRAY of targets, satisfied by a link matching ANY ONE of them — alternation/OR, additive alongside the existing single-target shape:

  ```json
  { "from": "roadmap", "to": ["spikes", "external-evidence"] }
  ```

  The rule above is satisfied by a `roadmap` doc linking to EITHER a `spikes`-kind doc OR an `external-evidence`-kind doc — either one is enough. An array `to` can mix a declared kind id with `{ external: "path" }` and/or `{ external: "url", pattern }` targets, e.g. `["decision", { "external": "url", "pattern": "https://github.com/OWNER/REPO/issues/" }]`.

  `scope: "sibling"` / `scope: { under: "..." }` still apply per kind-target alternative; every kind alternative is still orphan-checkable, not just the first. The missing-coverage report gets a dedicated line for an array `to`: `no link to ANY of: a "spikes"-kind doc, or a link matching "..." (required by kind "roadmap")`.

  A plain (non-array) `to` — every config written before this shipped — keeps decoding and behaving exactly as before; this is purely additive.

  Not included: general N-of-M cardinality (e.g. "at least 2 of these 3 alternatives must be linked"). Only "at least one of N" (OR/alternation) is expressed today — a real, narrower, still-open gap, recorded in `docs/design/CONVENTION.md`/`docs/design/review-prompts.md` rather than claimed closed.

- 101c0ea: `checks.coverage`'s rule `to` field now also accepts `{ atLeast: { n, of } }` — general N-of-M cardinality, satisfied when at least `n` of `of`'s targets EACH have their own satisfying link (not `n` links to the same target), additive alongside the existing single-target and array/`{ any }` shapes:

  ```json
  { "from": "roadmap", "to": { "atLeast": { "n": 2, "of": ["spikes", "external-evidence", "prior-art"] } } }
  ```

  The rule above requires a `roadmap` doc to link to at least 2 of the 3 listed kinds — linking to only one is not enough, and linking twice to the same one does not count as two. Requiring "all of these" needs no separate shape: it's `n` equal to `of`'s length over the same `atLeast` object.

  `{ any: [...] }` is also added as the explicit, named spelling of the array `to` shape that shipped previously (`to: [...]`) — both are accepted and behave identically; the bare array is not deprecated.

  Validated at config-decode time, the same as every other structural constraint in this schema: `atLeast.n` must be a positive integer (`n: 0` or negative is rejected — it would make the rule vacuously satisfied by nothing), must not exceed `atLeast.of.length` (a higher `n` could never be satisfied), `atLeast.of` must be non-empty, and `atLeast.of` must not contain a duplicate target (a duplicate would let one real satisfying link count toward `n` twice).

  A plain single target, an array `to`, or `{ any: [...] }` — every config written before this shipped — keeps decoding and behaving exactly as before; this is purely additive. This closes the general N-of-M cardinality gap that the previous array-`to` release deliberately left open (only "any one of N" was expressed then).

- 101c0ea: `cairn init --agent claude` now also scaffolds a second skill file,
  `.claude/skills/cairn-design-package/SKILL.md`, teaching how to build a structurally-enforced
  design package (problem-space/solution-space/spikes/story-map/roadmap/implementation-details/knowledge)
  using `checks.coverage`'s existing kinds/rules, with one small generic `scope: "sibling"`
  config block that closes a real, verified capturability gap (a shared wildcard kind lets a
  hollow package pass by cross-linking a real sibling's docs) without any per-package config,
  a vocabulary for naming relationships precisely (`grounded_by`/`builds_on`/`derived_from`/
  `sourced_from`, checked against real content rather than picked for sound), and guidance on
  stress-testing your own package before trusting it. Distinct from the existing
  `.claude/skills/cairn/SKILL.md` (summary-writing methodology) — different trigger, different
  content, own file.
- 101c0ea: `checks.coverage`'s `KindDef.description` field is now **unconditionally mandatory** —
  enforced at config decode time. Every kind declaration (e.g. `{ "id": "spec", "select": {
"by": "path", "glob": "docs/specs/*.md" } }`) must now also carry a `description` string.

  This is a real, stricter check, not just a bugfix — if you already use `checks.coverage`
  with a `kinds` array, `cairn check` will start failing to even load your config after
  upgrading unless every kind has a `description`. Add one explaining what the kind represents
  to fix it.

  Rationale: unlike a rule, which at least gets an auto-generated report sentence around it
  (`no link ("name") to a "X"-kind doc`), a bare kind id has no surrounding sentence at all —
  so there's no self-explanatory fallback to fall back on the way an unnamed rule has. Every
  kind needs its own real description to be legible to a reader with no prior context.

### Patch Changes

- 101c0ea: The generated `schema/cairn.schema.json` now expresses `checks.coverage`'s `to: { atLeast: { n,
of } }` rule shape's "`of` must not contain a duplicate target" requirement STRUCTURALLY, via the
  standard `uniqueItems: true` JSON Schema keyword on `atLeast.of` — closing a narrower follow-up
  left open by the previous `jsonschema-crossfield-hints` release, which could only add a prose
  `description` for this same constraint, not a real structural keyword. Verified against an
  independent JSON Schema engine (`ajv`), not just by re-reading the generated file: a config with a
  duplicate `atLeast.of` target is now rejected by editor-side JSON Schema validation, before `cairn
check` ever runs.

  No decode-time accept/reject outcome changes — every config that decoded successfully before
  still does, and every config `cairn check` rejected before is still rejected. The internal
  enforcement mechanism did change: `atLeast.of`'s duplicate-target rejection now lives entirely in
  `effect`'s own `Schema.isUnique()` (structural, key-order-insensitive comparison) rather than a
  hand-rolled `JSON.stringify` compare, which also happens to fix a real latent gap in the old
  check (two targets differing only in object-key order were previously, incorrectly, treated as
  distinct).

- 101c0ea: Fixed a latent bug in `checks.coverage`'s rule-deduplication: the dedup key used plain
  `JSON.stringify`, which is sensitive to object-property insertion order. Two `CoverageRule`
  values that were semantically identical but had their nested `to`/`scope` object keys built in
  a different order (possible via a hand-written config or a future programmatic rule-builder)
  could be treated as two _different_ rules instead of deduplicating to one — under-reporting
  the opposite way from every prior dedup-key bug this feature has hit. Fixed by canonicalizing
  object keys (recursively sorted) before stringifying. No config shape changed; this only
  affects internal deduplication, not what a valid config looks like.
- 101c0ea: The generated `schema/cairn.schema.json` now surfaces a prose `description` for every
  cross-field/cross-element constraint `checks.coverage` enforces at config-decode time but
  that plain JSON Schema cannot express structurally: an array `to`'s non-empty requirement,
  `{ atLeast: { n, of } }`'s `n`/`of` relationship (non-empty, no duplicate target, `n` not
  exceeding `of.length`), `scope: { under }`'s non-empty-after-trim requirement, and the
  top-level rule's undeclared-kind-id / description-mandatory-when-named checks.

  This does not add structural validation an editor's own JSON Schema tooling can enforce
  before `cairn check` runs — investigated directly against `effect`'s
  `Schema.toJsonSchemaDocument`, this is a genuine limit of plain JSON Schema for an
  arbitrary cross-field predicate, not something this release works around. It does mean an
  editor's autocomplete/tooltip can now at least explain the rule in prose instead of showing
  nothing at all for these fields. No decode-time behavior changes — every config that
  decoded successfully before still does, with the exact same accept/reject outcome.

## 0.8.0

### Minor Changes

- 5b8ef62: Added `checks.docCoverage` (closes #108): nothing previously checked whether a source file is documented anywhere at all — `checks.coverage` only ever asks doc→doc questions, so a repo could be fully green and still have entire modules nobody wrote a word about. `checks.docCoverage` closes that gap without generating a markdown file per source file: it declares `sources` globs (the files that must be covered) and one or more named `coveredBy` groups (globs over doc files whose direct outbound links count as covering a source file — a source file is covered if ANY one group's docs link to it, not all of them), plus an `exempt` list for intentionally undocumented files.

  Opt-in via mere presence in config, like `checks.coverage` — no CLI flag, `checks.docCoverage: false` re-disables it when inherited from an `extends` preset. Direct links only, matching `checks.coverage`'s own non-transitive rule.

## 0.7.0

### Minor Changes

- 605797a: `checks.coverage` rules can now target `{ "external": "path" }` instead of a declared doc kind — closes the third check from issue #28's v1 scope: doc→code reference resolution. A rule like

  ```json
  "rules": [{ "from": "spec", "to": { "external": "path" }, "name": "verified_by" }]
  ```

  is satisfied only when a `spec` doc links to a path that really exists on disk (source code, a test, anything — not just another scanned/kind-classified doc). Unlike a kind-based `to`, this never makes its target eligible for orphan reporting.

  This is a **stricter** check for anyone already using `checks.coverage` with a rule whose `to` they intend to change to `{ "external": "path" }` — existing configs (every `to` still a plain kind-id string) are completely unaffected, and no existing rule silently changes meaning.

- 8b44b29: Added `cairn check --report-deletions` (closes #106): link-completeness and content hashing both assume tracked content persists, so deleting a doc on the correct belief that it's pure duplication could silently lose a heading or outbound reference that existed nowhere else — every other check stayed green afterward. `--report-deletions` compares the working tree against a git ref (`--deletions-since`, default `HEAD`) and reports which of a deleted doc's headings/link targets survive in no remaining doc.

  Informational only, by design — it never affects the exit code. Deleting genuinely redundant documentation is a good thing that should stay cheap; this makes a lossy deletion visible, it doesn't block it. Needs a real git repository.

- 185788f: `roots` entries that can only legitimately resolve inside the project directory (no `..` segment anywhere or absolute path) now fail loudly with a clear error if the resolved directory turns out to be a symlink pointing outside the project — closing a gap where a malicious PR could replace a configured root (e.g. `docs/`) with a symlink to reach content outside the repository.

  This is a **stricter** check: if you rely on a plain `roots` entry (e.g. the default `"docs"`) resolving via a symlink to somewhere outside your project directory, `cairn check` will now fail with `cairn: root "..." resolves to "...", a symlink pointing OUTSIDE the project directory`. If that's intentional, express it with a `..`-relative or absolute path instead — those are unaffected and continue to work exactly as before (this is how a legitimate monorepo sibling-docs setup, e.g. `roots: ["../shared-docs"]`, is already expected to be configured).

### Patch Changes

- 6077f61: `--prose-refs` was labelled a "migration aid" in `--help`, the README, and scaffolded agent guidance — discouraging exactly the permanent, ongoing use it was actually safe for (closes #105). A citation that still resolves is always silent, so only genuine drift is ever reported; wording across `--help`, the README, `AGENTS.md`/scaffolded skill files, and code comments now states that permanent/ongoing use is supported, not just a one-time migration step. No behavior change — text only.
- 94f3fc6: `checks.coverage` — a config-only opt-in check with no CLI flag of its own — is now mentioned in `cairn check --help` and `cairn --help` (closes #104). Previously it was invisible to anyone who hadn't already read the README or the JSON schema by hand.
- 70a7206: Fixed link-completeness rejecting a link from a parent `_SUMMARY.md` straight to a child directory's own `_SUMMARY.md` (closes #103). Previously only a bare directory link (e.g. `[docs/](./docs)`) satisfied the check; `[docs/](./docs/_SUMMARY.md)` was reported as a missing child link even though it points at the curated index — the more precise, GitHub-rendering-friendly destination, and exactly the artifact whose content hash the summary tree tracks for that child. Both link forms now count.

  This is a **loosening**: a repo that previously carried both links (the documented workaround) is unaffected; a repo that only ever wrote the bare directory link is also unaffected. No existing passing config can newly fail.

- f75f07a: Fixed `ignore` glob patterns silently failing to match when written root-relative with no leading `**/` — the form anyone actually writes for a top-level path, e.g. `.agents/**` or `docs/SKIP.md` (closes #102). Previously only a pattern that either equalled the absolute filesystem path or was `**/`-prefixed (able to absorb an arbitrary prefix) actually excluded anything; every other pattern matched nothing, with no warning, leaving `cairn check` demanding summaries for directories the config believed were excluded.

  `ignore` patterns are now matched against both the absolute path (unchanged, so any pattern that already worked keeps working) and the path relative to the containing root — for directory pruning and for every checker's file-level `ignore` filter (links, refs, prose-refs, coverage, summaries) alike.

  This can newly EXCLUDE content from a repo's scan: if your `ignore` config already contains a pattern that happened to do nothing before (silently), that pattern may now correctly prune matching files/directories. Review your `ignore` list if `cairn check` reports fewer files checked after upgrading.

## 0.6.0

### Minor Changes

- 7d7b787: New, opt-in structural coverage/orphan check for teams using cairn to organize product knowledge (PRDs, specs, requirements, decision logs), not just code docs. Off by default — presence of `checks.coverage` in config is itself the opt-in, nothing changes for anyone who doesn't configure it.

  Declare doc kinds by path glob and a rule that every doc of one kind must link somewhere to a doc of another:

  ```json
  "checks": {
    "coverage": {
      "kinds": [
        { "id": "feature", "select": { "by": "path", "glob": "product/features/**" } },
        { "id": "decision", "select": { "by": "path", "glob": "docs/adr/**" } }
      ],
      "rules": [{ "from": "feature", "to": "decision" }],
      "exempt": ["product/features/templates/**"]
    }
  }
  ```

  Two file-level report classes, plus a config-level warning:

  - **missing coverage** — a `from`-kind doc with no outbound link to a `to`-kind doc.
  - **orphan** — a doc of a kind that's supposed to be referenced (a rule's `to` side) with zero inbound references from anywhere in the scanned corpus.
  - **unmatched kind** (⚠️, never fails the build) — a declared kind that matched zero scanned docs, most often because its glob falls outside `roots` (a kind's glob classifies docs cairn already scans, it never widens `roots` itself) or is simply mistyped. Without this, that mistake reads as `"✅ Coverage OK (0 doc(s) checked)"` — indistinguishable from a genuinely green repo.

  `exempt` (globs) opts a doc out of BOTH missing-coverage and orphan reporting entirely, not orphan status alone — the same escape hatch Sphinx's `:orphan:` and MkDocs' `not_in_nav` needed to keep their equivalent checks tolerable.

  A rule may carry an optional `name` (e.g. `"implements"` vs. `"verified_by"`) to distinguish two rules that share the same `from`/`to` kind pair but mean different things — two identically-named (or unnamed) rules on the same pair still dedupe as one. Every rule's `from`/`to` must reference a kind id declared in `kinds` — a typo there is now a loud config error at decode time, not a check that silently, permanently reports everything as missing. A rule may also carry an optional `via: { "by": "link" }`, naming how it's satisfied — the only implemented value today, and the implicit default when omitted, but a discriminated field (not hardcoded logic) so a future requirement type is a new value, not a breaking config change.

  This is the one check requirements-traceability tooling, safety-critical audit standards (DO-178C, IEC 62304), and doc generators (Sphinx, MkDocs, Confluence, Obsidian) have all independently converged on as foundational — and it's conspicuously absent from Markdown-specific lint tooling and every ADR tool. Reuses cairn's own existing link-extraction — no new Markdown syntax to author.

- 4f7a5aa: `checks.coverage` can now be re-disabled with `false`, letting a local config override an `extends` preset that enabled it — the same escape hatch `checks.links`/`checks.summaries` already had via their own booleans. Previously, once a preset turned coverage on, there was no way for a descendant config to turn it back off short of replacing `kinds`/`rules` with empty arrays (which still left the check enabled, just vacuously).

  Also fixes the README's own `checks.coverage` example: kind globs are matched against absolute filesystem paths, so a bare relative glob like `"product/features/**"` could never match a real scan — the example now correctly uses `"**/product/features/**"`, consistent with how the default `ignore` (`"**/node_modules/**"`) already works. The matching behavior itself is unchanged; only the documented example was wrong.

- 4f7a5aa: **Behavior change**: `cairn check` now exits non-zero when no configured root resolves to anything on disk (e.g. the default `docs/` doesn't exist and nothing else is configured) — previously this printed a `⚠️ No documentation roots found` warning but still exited 0, indistinguishable from genuine success by exit code alone, the one thing most CI/automation actually checks. The warning message is unchanged; `--json`'s `exitCode` field is corrected too, not just the process exit code.

  If your CI currently relies on the old lenient behavior (e.g. a pipeline stage that runs before any docs exist yet), configure `roots` to point somewhere that already exists, or gate the `cairn check` step accordingly.

### Patch Changes

- ed4d1e9: Fixes two more instances of the same quadratic-time (ReDoS) regex shape just fixed in the Markdown link checker's `LINK_RE` (see the sibling changeset in this release) — found by auditing the codebase for the same unbounded `[^\]]*`/`[^)\s]+` pattern rather than waiting for another one to surface independently. Both are real, reachable with ordinary (or adversarial) document content, not theoretical: `Anchors.ts`'s heading-anchor slugging (an inline link/image inside a heading, reduced to its own text before computing the anchor) and `ProseRefs.ts`'s bare-backtick-citation scanning (masking a real Markdown link's text span before candidate extraction) both scan every heading/every document's prose respectively. Fixed the same way — bounding every previously-unbounded quantifier at a generous 2000 characters — restoring linear-time scanning in both.
- a1953ae: Two fixes to the Markdown link checker, both in the same link-extraction regex:

  1. **False dead-link report for a `<...>`-wrapped destination.** CommonMark's own way to let a URL contain a literal `)` without it being confused for the link's own closing paren (a real, not-uncommon shape for Wikipedia/LibreTexts-style URLs) — `[text](<https://example.com/path_(with_parens)/more>)`. The link-extraction regex captured the `<`/`>` delimiters as part of the target instead of reading verbatim to the matching `>` first, which had two effects: an internal `)` truncated the captured target mid-URL, and — more broadly — the leaked leading `<` broke scheme detection (`isCheckableTarget`) so _any_ angle-bracket-wrapped external URL, parens or not, was mistaken for a local relative path and reported broken. Both are fixed; a bare (non-angle) destination's existing paren-truncation behavior is unchanged, since that ambiguity is exactly what `<...>` exists to resolve.

  2. **A real, pre-existing quadratic-time (ReDoS) vulnerability**, present since before this file's angle-bracket support was ever added — flagged by CodeQL (`js/polynomial-redos`) and confirmed empirically (a crafted doc with many unclosed `[` sequences and no closing `]` scaled the link scan quadratically with content length, a real denial-of-service risk on untrusted or messily-authored Markdown, not a theoretical finding). Fixed by bounding every previously-unbounded quantifier in the link-matching regex at a generous 2000 characters — link text and destinations are realistically far under that — restoring linear-time scanning.

- 4f7a5aa: `cairn init`'s scaffolded agent guidance (`AGENTS.md`, `CLAUDE.md`'s Claude rule, Copilot instructions, the `cairn` skill) now names every opt-in check — `--refs`, `--prose-refs`, and `checks.coverage` — not just the always-on summaries+links baseline. Previously an agent working in a fresh repo had no way to discover these features short of separately reading the npm README, which a repo-scoped agent doesn't naturally do.

## 0.5.1

### Patch Changes

- d801615: Fixes a false "0 files, all clean" from `cairn check`: `listWorktreeDirs` already excluded `base` itself from the worktree-pruning list, but not a worktree that is an ANCESTOR of `base` on disk — the exact shape produced when a linked worktree is nested inside another worktree's own directory (e.g. `<primary>/.claude/worktrees/<name>`, as an agentic dev workflow creates) rather than living as a sibling under a shared parent. Running `cairn check` from inside such a nested worktree turned the ancestor's path into an `ignore` pattern that also matched every file under the current scan root, silently excluding it entirely. Worktrees that are ancestors of `base` are now excluded from the result the same way `base` itself already was.

## 0.5.0

### Minor Changes

- f002b95: Fixes a real OOM crash (issue #63): pointing `roots` at or near a repository root (e.g. `roots: ["."]`) used to fully walk and `stat` every file under any ignored directory — including a real `node_modules` — before `ignore` was ever consulted, since filtering only ever happened after the whole tree was already materialized. `ignore` (and the default `"**/node_modules/**"` pattern) now prunes a matching directory during the walk itself, never descending into it at all.

  Also new: cairn now consults `.gitignore` automatically (via `git ls-files --others --ignored --exclude-standard --directory`) to prune gitignored directories the same way, with zero configuration — a gitignored `build/`, `dist/`, or similarly-named directory that doesn't happen to match a configured `ignore` glob is pruned too. This is an always-on default, independent of `onlyGitTracked`; unlike `onlyGitTracked`, it degrades gracefully (falls back to `ignore`-only pruning) rather than failing when `git` is unavailable or the directory isn't a git repository, since it's a safety net, not an opt-in guarantee.

  One named, deliberate scope decision: for `cairn check --links-only`, a link pointing _into_ a pruned directory (previously resolvable, since `ignore` only affected the source-scan set, not the existence universe) now reports broken instead. Considered an acceptable trade — a doc legitimately linking into an ignored directory is a vanishingly rare case next to the tool no longer OOM-crashing on an ordinary repository.

- f002b95: Follow-up to the issue #63 walk fix. Two changes:

  - **Linked git worktrees (e.g. `.claude/worktrees/<name>`) are now pruned automatically**, the same way a gitignored directory already is — via `git worktree list --porcelain`, zero configuration required. A linked worktree nests a full second copy of the repo's own doc tree inside the primary one; walking it used to double every summary/link finding, and if it had its own real `node_modules` checked out, could reintroduce the exact issue #63 OOM shape one directory deeper. Like the existing gitignore-based pruning, this is an always-on default that degrades gracefully (falls back to no worktree pruning) when git is unavailable, rather than failing.
  - **The walk itself is faster.** Determining file-vs-directory for each entry used to cost a separate `fs.stat` call per entry on top of the `readdir` that already listed them. It now reads that type directly off the `Dirent` `readdir` already returns (`withFileTypes: true`), at no cost to crash-resilience — a broken symlink still needs (and gets) a link-following `stat` to resolve, and is still excluded rather than crashing the scan. Measured on a synthetic 16,400-entry fixture: median wall time dropped from ~143ms to ~27ms (~5×).

- 4eab988: `effect`, `@effect/platform-node`, and `github-slugger` are no longer regular `dependencies` — the published `cairn` CLI (`dist/cli.js`) is fully bundled by esbuild and never needed them resolvable from a consumer's `node_modules` at runtime, so every install of cairn was pulling all three in for nothing.

  The concrete harm: `@effect/platform-node@4.0.0-beta.100` declares a _required_ (non-optional) peer dependency on `ioredis@^5.7.0`. Package managers with auto-install-peers behavior (e.g. pnpm) were therefore installing a real `ioredis` into every consumer's dependency graph purely to satisfy that peer — even though cairn never touches Redis. That `ioredis` could then become peer-satisfying for an unrelated package elsewhere in a consumer's tree, silently flipping which build variant that unrelated package resolved to. Removing the runtime dependency removes `ioredis` (and any other transitive peer surface from that chain) from ever reaching consumers.

  `effect` and `github-slugger` are still needed by cairn's unbundled programmatic library export (`import { ... } from '@sledorze/cairn'`) — they're now declared as **optional** `peerDependencies` instead. This is a behavior change worth flagging if you use that entrypoint: your own `package.json` must now declare `effect` and `github-slugger` directly (`pnpm add effect github-slugger`) — they will no longer show up for free via cairn. If you only use the `cairn` CLI, this changes nothing for you: nothing extra installs, and nothing extra is required.

### Patch Changes

- fb1a499: Fixes a real correctness gap: `cairn check` (and the underlying `GitFsLive` used for `onlyGitTracked`, gitignore-based pruning, and linked-worktree pruning) could silently consult the _wrong_ git repository when run from inside a git hook of a linked `git worktree` checkout. Git exports `GIT_DIR` into hook subprocesses in that case, and `GIT_DIR` silently overrides `-C <base>` — confirmed empirically, not assumed. Every `git` invocation in `src/io/Git.ts` now scrubs the canonical set of repository-pinning environment variables (`git rev-parse --local-env-vars`) before shelling out, so `-C base` is always authoritative regardless of the calling environment.

  If you wire `cairn check` into a pre-commit or pre-push hook (as this repo's own README recommends) and work from a linked worktree, this changes which repository's tracked/ignored/worktree state your hook actually consults — previously it may have silently been the wrong one.

  Also hardens the same code path against a second, independent failure mode: `GitFsLive` now sets `GIT_CEILING_DIRECTORIES` (git's own repository-discovery boundary) alongside the env scrub, so a `base` without its own `.git` can no longer silently resolve to an ancestor repository instead of failing.

  **A third, unrelated bug found while dogfooding this fix, also fixed here:** `listWorktreeDirs` excluded "whichever worktree `git worktree list` reports first" instead of excluding `base` itself — those are the same thing only when `base` is the primary worktree. Running `cairn check` from a **linked** worktree (not the primary) left `base` itself in the reported worktree list; `cli.ts` adds every reported worktree to its `ignore` list as `${dir}/**`, so this silently excluded the entire scan root — a false "0 files, all clean" instead of an error. If you run `cairn` from a linked git worktree, this is a real behavior change: it now actually scans your files, where before it silently scanned nothing.

  Fixed alongside it: the same exclusion now also resolves symlinks before comparing (`git worktree list` reports its own realpath-resolved form regardless of the literal path a worktree was reached through — confirmed empirically), so a `base` reached through a symlinked path (e.g. macOS's `/tmp` resolving to `/private/tmp`) can't reintroduce the identical bug in symlink form. Also hardened against a worktree directory deleted without `git worktree remove` first (an ordinary mistake) — a stale `prunable` entry with a path that no longer exists on disk no longer crashes the scan.

## 0.4.0

### Minor Changes

- 70c809e: `cairn check --fix` now auto-repairs a broken heading anchor (same-page and cross-file) when it differs from a real heading/`<a id="...">` anchor by case alone — an unambiguous, exact match, never a fuzzy guess. Two case-colliding anchors, or no match at all, are left unchanged and still reported, same as today (issue #49). Also fixes a related, pre-existing bug found while implementing this: a same-page anchor with URL-encoded characters (e.g. `#Setup%2DPattern`) is now percent-decoded before matching/suggesting, matching how cross-file anchors were already handled.
- 2213b86: New, opt-in `onlyGitTracked` config option (issue #48): when `true`, both summary-freshness scanning and link-target existence checks are restricted to `git ls-files`' tracked-or-staged set (the index, not just the last commit) — so a local run sees exactly the same file universe a fresh CI checkout would. An untracked doc is skipped entirely (no "missing summary"), and a link to an untracked file reports broken even if it's present on disk locally. Default `false`, byte-for-byte unchanged from today. When enabled, a missing/unavailable `git` binary is a hard error, never a silent fallback.
- 303047f: New, opt-in `cairn check --prose-refs` (issue #47): flags a bare-backtick file citation in prose (e.g. `` `src/services/auth.ts` ``, no `[text](path)` syntax at all) whose target has actually moved, been renamed, or deleted. Deliberately a migration aid, not a permanent second link checker — a citation that still resolves is always silent, and the report names the exact Markdown link syntax that would make it structurally checkable going forward, rather than just saying "broken." Off by default, not part of the `checks.links`/`checks.summaries` gate.

### Patch Changes

- 2b9cfed: Bug fixes found via systematic adversarial dimension-coverage review of three recently-shipped features:

  - `cairn check --fix`: a broken link/anchor target repeated more than once in the same file (an ordinary authoring pattern — e.g. mentioned in prose and again in a "See also" list) was fully and correctly repaired on disk, but incorrectly reported as still broken for its second occurrence (wrong `fixed` count, wrong exit code, spurious entry in `broken`/`--json`).
  - `cairn check --prose-refs`: a citation with trailing whitespace inside the backticks (e.g. `` `src/x.ts ` ``) was silently reported as drifted even though the trimmed path resolves fine — a false positive on ordinary input. An absolute-path-shaped citation is no longer treated as a candidate (a real filesystem path, not a repo-rooted one). A backtick citation that's already inside a real Markdown link's text is no longer double-reported alongside the link checker.
  - `cairn check --prose-refs`/`--refs`: now respect `ignore` and `onlyGitTracked`, matching every other check — previously silently scanned/stamped excluded or untracked docs regardless.

- 55bd736: Fixes several real, user-triggerable crashes found via adversarial "no unhandled exception" review — `cairn check` (and `--refs`/`--prose-refs`) previously died with a raw internal stack trace, instead of a clean report, when scanning a docs tree containing:

  - a broken symlink,
  - an unreadable (permission-denied) subdirectory,
  - a permission-denied doc file.

  A **nested** broken symlink or unreadable subdirectory is now silently excluded from the scan (matching how an ordinary non-file directory entry is already treated) — but a **root** directory (the one you actually configured/passed) that can't be read at all still fails the run rather than being treated as empty: an earlier version of this fix conflated the two, and a permission-denied root silently reported `✅ OK, 0 file(s) checked` with exit 0 — a false "all clear" that's worse than the original crash, caught by a second, independent round of adversarial review before this shipped.

  A permission-denied doc file is new, explicit, and non-silent for `cairn check`/`--links-only`: it's listed in a new `unreadable` field on the link-check result (also surfaced in `--json`), reported clearly, and makes the run exit non-zero. `--summaries-only`, `--refs`, and `--prose-refs` skip an unreadable doc without crashing, matching the same "never crash on one bad file" guarantee, though deliberately without the richer `unreadable` reporting `--links-only` gets (a wider fix there would touch `SummaryPlan`'s widely-consumed pure shape) — for `--summaries-only` specifically, an unreadable-but-existing summary currently reads as `missing` rather than distinctly `unreadable`, a known, named scope decision, not silently glossed over.

  Also fixes a latent (currently unreachable) correctness landmine found via review of the recent `applyFixesToFile` extraction: the decision of whether to write a repaired file back to disk is now driven by `applyFix`'s own `changed` flag end-to-end, not by comparing before/after file content as strings — the two can legitimately disagree when a suggested replacement is textually identical to the original.

## 0.3.0

### Minor Changes

- 2b4f930: New, opt-in `cairn check --refs` (issue #39, Scenario I, v1/whole-file): with `--stamp`, records the content hash of every real reference a doc makes (a cross-file or cross-hierarchy link target) into `.cairn/refs/**`; without `--stamp`, reports any whose target content has changed since — "may be stale," a distinct signal from a broken link, since the target still exists and the link still resolves. Not part of the default `checks.links`/`checks.summaries` gate; must be explicitly requested.
- 2b4f930: `cairn check`'s link checker now validates heading anchors (`[text](./guide.md#section)` and same-page `[text](#section)`, GitHub-slug compatible) and resolves link targets outside the configured `roots` as long as they stay inside the repository checkout — both previously silently accepted regardless of whether they were actually true. It also validates GitHub-style line anchors (`#L10`, `#L10-L20`) on such cross-hierarchy targets. Existence/anchor checks for anything outside the checkout root are never attempted, by design. `BrokenLink` gained an additive, optional `reason: 'path' | 'anchor' | 'line'` field in `--json` output.

  This can flip a previously-green repo to red: an anchor or cross-hierarchy link that was never actually checked before may now be reported broken if it doesn't really resolve.

## 0.2.0

### Minor Changes

- 7f170c0: Move the summary freshness stamp out of file content into a hidden, hierarchy-mirroring `.cairn/**` sidecar tree, so tracking metadata never pollutes authored prose and can grow (e.g. future per-relation manifests) without ever touching a content file.

  - `cairn check --stamp` now writes `.cairn/<mirrored-path>.json` instead of a `<!-- source-sha256 -->` comment inside the summary; summary content is never mutated by the tool.
  - **Upgrading requires no new command.** `--stamp` (already what every existing `.cairnrc.json`'s `stampCommand` runs) now self-heals: it strips any leftover legacy in-content stamp it finds and writes the `.cairn/` sidecar in the same pass. `cairn check --migrate-stamps` also exists as an explicitly-named alias of the same behavior, purely for anyone who wants the cleanup reported as its own step — it is never required.
  - `cairn check --prune` now also removes orphan `.cairn/**` sidecars (a sidecar with no matching source doc — a deletion signal the old in-content scheme couldn't see once the summary file itself was also deleted).
  - Breaking: `CheckSummariesArgs`/`checkSummaries`/`stampSummaries`/`explainSummaries`/`pruneOrphans` (programmatic API) now require a `base` field (the project root sidecars are resolved under). `PlanArgs`/`SummaryPlan` in the pure planner gained an optional `stamps` input and a new `orphanStamps` output field.
  - `.cairn/` must be committed (not gitignored) alongside your docs, same as the old stamp comment was.

## 0.1.1

### Patch Changes

- 8aa909b: Internal CI/tooling improvements since v0.1.0: a relative perf-regression gate
  (`pnpm bench`, local pre-push hook + CI backstop covering both source-level
  micro-benchmarks and the actual built `dist/cli.js` startup time), automated
  patch/minor Dependabot PR merging, and this automated release flow itself
  (changesets/action wiring up git tags, changelogs, and GitHub Releases, which
  were silently missing for the v0.1.0 publish). No user-facing behavior change.
