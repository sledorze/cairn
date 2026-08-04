# Implementation details: issue #101

Concrete enough to start Release 1 from directly; Release 2/3 sections are more
provisional (marked) since they depend on Release 1 shipping first and real usage.

## Release 1 — `refs.scope`

### Config (`core/Config.ts`)

New optional key alongside the existing `refs`-adjacent CLI flags (today `--refs` has NO
config-level presence at all — it's pure CLI, unlike `checks.coverage`/`checks.docCoverage`
which are config-presence-gated). This is the first config-level knob `--refs` gets;
namespace it under a NEW top-level `refs` key, not nested under `checks`, since `--refs`
itself stays a CLI flag (opt-in per-invocation), not a `checks.*`-style always-on-if-present
gate — the two opt-in mechanisms are already different for `--refs` and this shouldn't
change that.

```ts
const RefsScopeGroupInputSchema = Schema.Struct({
  glob: Schema.String,
  unit: Schema.Literals(['whole-file', 'ignore']), // Release 2 adds 'exports-only' here
}).annotate({
  identifier: 'CairnRefsScopeGroup',
  description: 'One glob and the granularity `--refs` uses for content matching it.',
})

const RefsInputSchema = Schema.Struct({
  scope: Schema.optionalKey(Schema.Array(RefsScopeGroupInputSchema)),
}).annotate({ identifier: 'CairnRefsConfig' })
```

`sources`/`coveredBy`-style FIRST-MATCH-WINS semantics (not `checks.docCoverage`'s
OR-across-all-groups semantics — different question: "what glob group does this ONE target
belong to," not "is this target covered by ANY group"). First matching `scope` entry
(array order) determines a target's `unit`; no match means `whole-file` (today's only
behavior, unchanged default).

### `CheckRefs.ts` changes

`resolveReferenceContent` (`CheckRefs.ts:83`) gains a `unit` parameter. `unit === 'ignore'`
short-circuits to `null` BEFORE the `isSafelyWithinBase` check even runs — an ignored glob
is never read at all, not read-then-discarded (matches this repo's own "don't touch the
filesystem for something structurally excluded" discipline, e.g. `isPrunedDir`'s
directory-level pruning in `DocsFs.ts` happening BEFORE `readDirectory`, not after).

`stampRefs`/`checkRefs` both need the resolved `scope` list threaded through from
`CheckRefsArgs` (new optional `scope?: readonly RefsScopeGroup[]` field, `[]` default) and
matched per-target the same way `matchesConfiguredGlob` does in
`program/structure/CheckDocCoverage.ts` (reuse that helper directly, or extract it to
`core/glob.ts` if a third consumer would otherwise duplicate it — check at implementation
time whether a third near-identical copy is forming; if so, extract, per this repo's own
"don't hand-duplicate a filter across three files" precedent, `DocsFs.ts`'s
`listMarkdownFiles`/`readMarkdownCorpus` extraction comment).

### Wiring (`cli.ts`)

**Correction, found by adversarial review of an earlier draft of this document:** an
earlier version of this section claimed `CheckRefs.ts` "isn't a `CheckPlugin`" and treated
that as an open question to "confirm at implementation time." That claim was already false
when written, not just later-drifted — `CheckRefs.ts` exports `refsPlugin: CheckPlugin<
RefsCheckResult>` (`CheckRefs.ts:252`), and `cli.ts` already registers it in
`JSON_INCOMPATIBLE_PLUGINS` and drives it through `runCheckPlugin`, same as `coveragePlugin`/
`docCoveragePlugin`. This migration landed in an ancestor commit, before this design branch
even forked — a real instance of exactly the "grepped, not assumed" discipline `AGENTS.md`
asks for, that this document itself failed to apply to its own claim on first pass.

**What this actually means for Release 1, now correctly stated:** there is no open
architectural question here at all. `refsPlugin.run` (`CheckRefs.ts`) already receives
`CheckRunArgs` (`resolved`, `base`, `ignore`, `trackedFiles`, ...) the same way
`docCoveragePlugin.run` does — `refs.scope` is simply a new field read off
`resolved` (once `Config.ts` carries it) and threaded into `CheckRefsArgs`, exactly
mirroring how `docCoveragePlugin.run` already pulls `coveredBy`/`exempt`/`sources` off
`resolved.checks.docCoverage` (`CheckDocCoverage.ts`'s own `run` implementation is the
template to copy, not a hypothetical to design from scratch). This makes Release 1's CLI
wiring cost LOWER than an earlier draft implied, not an open design question.

### Tests (mirroring this repo's own existing `--refs` test suite)

- Unit: a target matching `unit: 'ignore'` is never included in `stampRefs`'s sidecar, and
  never reported by `checkRefs` even if its real content changed.
- Unit: `isSafelyWithinBase` is never called for an ignored target (spy/count assertion,
  matching `CheckCoverage.unit.test.ts`'s own "never touches the filesystem for X" pattern
  cited in this repo's `AGENTS.md`).
- Integration: real filesystem, a `refs.scope` config with one `ignore` glob, confirm a
  real content edit under that glob doesn't fail `--refs`.
- Real CLI dogfood (per this repo's own now-doubly-established convention, from both #108's
  and #101's — this doc's own — work): reconstruct the reporter's actual repro (many leaf
  files cited, one exempted via `ignore`), confirm editing an exempted leaf stays green,
  confirm editing a NON-exempted cited file still fails.

## Release 2 — `unit: "exports-only"` (provisional — implementation TBD pending Release 1)

### Export-boundary extraction (new module, `core/links/TsExports.ts` or similar — stays in

`core/`, IO-free, matching this repo's `core/` policy since it's pure text-in/ranges-out)

Built on [`spikes.md`](./spikes.md) spike 4's confirmed-viable primitive: `typescript/unstable/ast`'s
`createScanner`, tokenizing the file's text and locating each `ExportKeyword` token, then
scanning forward to that statement's end (the scanner's own token stream already correctly
skips over string/template/comment content — no separate brace-counting needed, unlike
option C's rejected heuristic).

**Open question, not resolved by this design, flagged for the ADR:** does the hash cover
JUST the exported signature (name + type annotation, no function body), or the WHOLE
exported declaration including its body? `solution-space.md`'s option B originally framed
it as "signature only," but spike 4's scanner locates the whole statement equally easily
either way — the CHOICE is a tradeoff (signature-only misses "the exported function's
behavior changed, but its type signature didn't," which `problem-space.md`'s constraint 1
would say matters; whole-exported-declaration is closer to Release 1's `whole-file`
granularity, just narrowed to one declaration) that needs a real second spike against
actual reported false-positive/false-negative cases once Release 2 implementation starts,
not a decision made speculatively here.

**Ordering:** hash is computed over exports in a canonical order (e.g. sorted by name, not
source order) — so a pure REORDERING of unrelated exports in the file (a common,
meaning-preserving refactor) doesn't itself count as drift. This is a real decision this
design DOES make (unlike the signature-vs-body question above): source-order hashing would
make export reordering — semantically a no-op — register as false drift, which
`problem-space.md`'s constraint 1 doesn't require catching (it's not "a real, relevant"
change) and would reintroduce a smaller version of the exact whole-file-noise problem this
whole design exists to fix.

### Packaging: `typescript` must follow the `effect`/`github-slugger` precedent

`typescript` is currently a `devDependency` (`package.json`), never shipped to consumers.
This repo's two real runtime dependencies (`effect`, `github-slugger`) are both
`peerDependencies` with `peerDependenciesMeta.*.optional: true` — a user who never touches
the programmatic API pays nothing for them. Release 2 must follow the SAME shape: add
`typescript` as an optional peer dependency, and `unit: "exports-only"` must fall back to
`whole-file` with a clear, explicit warning (never a silent, unexplained no-op) when
`typescript` isn't actually installed in the consuming project — not become the first hard,
always-installed runtime `dependency` this codebase has ever had
(`problem-space.md` constraint 3).

### `RefRecord`/`StaleRef` shape changes

`RefRecord` (`RefStore.ts:39`) needs a way to record WHICH exports were hashed together
(so a later run can tell "an export was added/removed" apart from "an export's content
changed") — likely `readonly exportHashes?: Record<string, string>` alongside (not
replacing) the existing whole-target `hash` field, so a `whole-file`-unit record's shape
stays completely unchanged (backwards compatible, per `problem-space.md` constraint 4).
`REFS_VERSION` does NOT need a bump for this (additive optional field — same tolerance
`RefStore.ts`'s own header comment already documents for the codec).

## Release 3 — symbol-scoped citations (provisional — implementation TBD pending Release 2)

Reuses Release 2's export-boundary finder, keyed by the citation's own `anchor` instead of
"every export." The rename-resilience requirement (`roadmap.md`'s hard gate) means
`checkRefs` must distinguish "the named export no longer exists in this file" (a distinct,
actionable report — story-map.md's own story) from "the named export's content changed"
(ordinary drift) — requires the extractor to return the FULL set of found export names
even when only one is being tracked, so a lookup miss is diagnosable rather than a bare
`undefined`.

## Cross-cutting risks (apply to all three releases)

- **`typescript/unstable/*` is explicitly unstable** (spike 5's own finding) — Release 2/3
  code must be isolated behind a narrow internal interface (`extractExportRanges(content):
{name, start, end}[]`) so a future `typescript` major that reshuffles the `unstable/ast`
  surface again only requires updating ONE module's internals, not every call site. This is
  the same "one shared definition, not four independent re-derivations" principle this
  repo's own `DocsFs.isSafelyWithinBase` extraction comment documents — applied
  proactively here instead of after a second copy is found.
- **Every new code path re-uses `isSafelyWithinBase`** — no release here reads anything
  `resolveReferenceContent` doesn't already safely reach today.
