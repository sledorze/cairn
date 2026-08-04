import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'

import type { CoverageRule } from '../../core/Config.ts'
import type { DocsFsService } from '../../io/DocsFs.ts'
import { DocsFs, makeTestDocsFs } from '../../io/DocsFs.ts'
import { checkCoverage, coverageExitCode, formatCoverageReport } from './CheckCoverage.ts'

const KINDS = [
  { id: 'feature', select: { by: 'path' as const, glob: '/r/features/**' } },
  { id: 'decision', select: { by: 'path' as const, glob: '/r/decisions/**' } },
]
const RULES = [{ from: 'feature', to: 'decision' }]

describe('checkCoverage()', () => {
  it('reports nothing when a feature links to a decision — real coverage', async () => {
    const layer = makeTestDocsFs({
      '/r/decisions/d1.md': { content: '# Decision', mtimeMs: 1 },
      '/r/features/f1.md': { content: '# Feature\n\n[why](../decisions/d1.md)', mtimeMs: 1 },
    })
    const result = await Effect.runPromise(
      checkCoverage({ base: '/r', kinds: KINDS, roots: ['/r'], rules: RULES }).pipe(Effect.provide(layer)),
    )
    expect(result.checked).toBe(2) // both docs match a declared kind
    expect(result.missing).toEqual([])
    expect(result.orphans).toEqual([])
    expect(coverageExitCode(result)).toBe(0)
  })

  it('never scans a non-.md file, even one under a declared kind glob', async () => {
    const layer = makeTestDocsFs({
      '/r/decisions/d1.md': { content: '# Decision', mtimeMs: 1 },
      '/r/decisions/notes.txt': { content: 'not markdown at all', mtimeMs: 1 },
    })
    const result = await Effect.runPromise(
      checkCoverage({ base: '/r', kinds: KINDS, roots: ['/r'], rules: [] }).pipe(Effect.provide(layer)),
    )
    expect(result.checked).toBe(1) // notes.txt never counted
  })

  it('excludes a doc matching `ignore`, same as every sibling check', async () => {
    const layer = makeTestDocsFs({
      '/r/decisions/d1.md': { content: '# Decision', mtimeMs: 1 },
      '/r/decisions/generated.md': { content: '# Generated, must be excluded', mtimeMs: 1 },
    })
    const result = await Effect.runPromise(
      checkCoverage({
        base: '/r',
        ignore: ['/r/decisions/generated.md'],
        kinds: KINDS,
        roots: ['/r'],
        rules: [],
      }).pipe(Effect.provide(layer)),
    )
    expect(result.checked).toBe(1)
  })

  // Issue #102: a root-relative pattern with no leading `**/` (the form
  // anyone actually writes, as opposed to the absolute-path pattern used
  // above) must exclude a doc just as reliably — regression coverage
  // exercised through the real checker, not just `isIgnored`'s own unit
  // tests.
  it('excludes a doc matched by a root-relative `ignore` pattern with no leading **/ (issue #102)', async () => {
    const layer = makeTestDocsFs({
      '/r/decisions/d1.md': { content: '# Decision', mtimeMs: 1 },
      '/r/decisions/generated.md': { content: '# Generated, must be excluded', mtimeMs: 1 },
    })
    const result = await Effect.runPromise(
      checkCoverage({
        base: '/r',
        ignore: ['decisions/generated.md'],
        kinds: KINDS,
        roots: ['/r'],
        rules: [],
      }).pipe(Effect.provide(layer)),
    )
    expect(result.checked).toBe(1)
  })

  it('reports a feature with zero links to any decision as missing coverage', async () => {
    const layer = makeTestDocsFs({
      '/r/decisions/d1.md': { content: '# Decision', mtimeMs: 1 },
      '/r/features/f1.md': { content: '# Feature, no links at all', mtimeMs: 1 },
    })
    const result = await Effect.runPromise(
      checkCoverage({ base: '/r', kinds: KINDS, roots: ['/r'], rules: RULES }).pipe(Effect.provide(layer)),
    )
    expect(result.missing).toEqual([{ path: '/r/features/f1.md', rule: { from: 'feature', to: 'decision' } }])
    expect(coverageExitCode(result)).toBe(1)
  })

  it('exempts a doc matching `exempt` from missing-coverage reporting too, not just orphan reporting', async () => {
    const layer = makeTestDocsFs({
      '/r/decisions/d1.md': { content: '# Decision', mtimeMs: 1 },
      '/r/features/templates/blank.md': { content: '# Feature template, no links, intentionally', mtimeMs: 1 },
    })
    const result = await Effect.runPromise(
      checkCoverage({
        base: '/r',
        exempt: ['/r/features/templates/**'],
        kinds: KINDS,
        roots: ['/r'],
        rules: RULES,
      }).pipe(Effect.provide(layer)),
    )
    expect(result.missing).toEqual([])
  })

  it('a doc with SOME (not all) of its kinds being orphan-candidates is still orphan-checked', async () => {
    const mixedKinds = [...KINDS, { id: 'internal', select: { by: 'path' as const, glob: '/r/decisions/**' } }]
    const layer = makeTestDocsFs({
      '/r/decisions/d1.md': { content: '# Decision, also internal, nobody links here', mtimeMs: 1 },
    })
    const result = await Effect.runPromise(
      checkCoverage({ base: '/r', kinds: mixedKinds, roots: ['/r'], rules: RULES }).pipe(Effect.provide(layer)),
    )
    // d1.md matches BOTH 'decision' (an orphan-candidate, per RULES) and
    // 'internal' (not a candidate) — `.some`, not `.every`, decides
    // in-scope status, so it must still be reported.
    expect(result.orphans).toEqual([{ kinds: ['decision', 'internal'], path: '/r/decisions/d1.md' }])
  })

  it('a link to a doc that does NOT resolve to the required kind does not satisfy coverage', async () => {
    const layer = makeTestDocsFs({
      '/r/decisions/d1.md': { content: '# Decision', mtimeMs: 1 },
      '/r/features/f1.md': { content: '# Feature\n\n[unrelated](../notes/other.md)', mtimeMs: 1 },
      '/r/notes/other.md': { content: '# Not a decision, and not a declared kind at all', mtimeMs: 1 },
    })
    const result = await Effect.runPromise(
      checkCoverage({ base: '/r', kinds: KINDS, roots: ['/r'], rules: RULES }).pipe(Effect.provide(layer)),
    )
    expect(result.missing).toEqual([{ path: '/r/features/f1.md', rule: { from: 'feature', to: 'decision' } }])
  })

  // Orphan status only applies to a kind that's actually a rule's `to` side
  // (see CheckCoverage.ts's own comment) — "feature" here is a from-only
  // kind, never expected to be referenced back, so it must never appear in
  // `.orphans` even though nothing links to it either.
  it('reports a decision with zero inbound references from anywhere as orphaned, but never a from-only kind', async () => {
    const layer = makeTestDocsFs({
      '/r/decisions/d1.md': { content: '# Decision, nobody links here', mtimeMs: 1 },
      '/r/features/f1.md': { content: '# Feature, no links', mtimeMs: 1 },
    })
    const result = await Effect.runPromise(
      checkCoverage({ base: '/r', kinds: KINDS, roots: ['/r'], rules: RULES }).pipe(Effect.provide(layer)),
    )
    expect(result.orphans).toEqual([{ kinds: ['decision'], path: '/r/decisions/d1.md' }])
  })

  // The referencing doc (`notes/random.md`) matches no declared kind at
  // all — its own reference must still count for the TARGET's inbound
  // graph, even though `random.md` itself is never reported on.
  it('an inbound reference from ANY doc (not just a rule-declared kind) clears orphan status', async () => {
    const layer = makeTestDocsFs({
      '/r/decisions/d1.md': { content: '# Decision', mtimeMs: 1 },
      '/r/notes/random.md': { content: 'see [d1](../decisions/d1.md)', mtimeMs: 1 },
    })
    const result = await Effect.runPromise(
      checkCoverage({ base: '/r', kinds: KINDS, roots: ['/r'], rules: RULES }).pipe(Effect.provide(layer)),
    )
    expect(result.orphans).toEqual([])
  })

  it('exempts a doc matching `exempt` from orphan reporting', async () => {
    const layer = makeTestDocsFs({
      '/r/decisions/templates/blank.md': { content: '# Template, intentionally unlinked', mtimeMs: 1 },
    })
    const result = await Effect.runPromise(
      checkCoverage({
        base: '/r',
        exempt: ['/r/decisions/templates/**'],
        kinds: KINDS,
        roots: ['/r'],
        rules: RULES,
      }).pipe(Effect.provide(layer)),
    )
    expect(result.orphans).toEqual([])
  })

  it('never flags a doc matching no declared kind as an orphan — only declared-kind docs are in scope', async () => {
    const layer = makeTestDocsFs({
      '/r/notes/random.md': { content: '# Random note, not a declared kind', mtimeMs: 1 },
    })
    const result = await Effect.runPromise(
      checkCoverage({ base: '/r', kinds: KINDS, roots: ['/r'], rules: [] }).pipe(Effect.provide(layer)),
    )
    expect(result.checked).toBe(0) // matches no declared kind, out of scope entirely
    expect(result.orphans).toEqual([])
  })

  it('excludes a doc outside `trackedFiles`, same as every sibling check’s onlyGitTracked support', async () => {
    const layer = makeTestDocsFs({
      '/r/decisions/d1.md': { content: '# Decision', mtimeMs: 1 },
      '/r/decisions/untracked.md': { content: '# Untracked, must be excluded entirely', mtimeMs: 1 },
    })
    const result = await Effect.runPromise(
      checkCoverage({
        base: '/r',
        kinds: KINDS,
        roots: ['/r'],
        rules: [],
        trackedFiles: new Set(['/r/decisions/d1.md']),
      }).pipe(Effect.provide(layer)),
    )
    expect(result.checked).toBe(1)
  })

  // Adversarial finding, not from the original TDD pass: an accidentally
  // (or programmatically) duplicated rule entry used to produce a
  // duplicate `missing` report line for the exact same violation — pure
  // noise, not a second real finding.
  it('reports a violation once, even when the SAME rule is declared twice', async () => {
    const layer = makeTestDocsFs({
      '/r/features/f1.md': { content: '# Feature, no links', mtimeMs: 1 },
    })
    const result = await Effect.runPromise(
      checkCoverage({ base: '/r', kinds: KINDS, roots: ['/r'], rules: [...RULES, ...RULES] }).pipe(
        Effect.provide(layer),
      ),
    )
    expect(result.missing).toEqual([{ path: '/r/features/f1.md', rule: { from: 'feature', to: 'decision' } }])
  })

  // Two GENUINELY DIFFERENT rules (sharing `from`, different `to`) must
  // never collapse into one — both violated here so losing EITHER would be
  // observable (a naive from/to dedup key that ignores `to`, or a bug that
  // only keeps the last-declared rule, would silently under-report).
  it('evaluates two different rules independently — both violations reported, neither lost', async () => {
    const layer = makeTestDocsFs({
      '/r/features/f1.md': { content: '# Feature, no links at all', mtimeMs: 1 },
    })
    const twoRuleKinds = [...KINDS, { id: 'spec', select: { by: 'path' as const, glob: '/r/specs/**' } }]
    const result = await Effect.runPromise(
      checkCoverage({
        base: '/r',
        kinds: twoRuleKinds,
        roots: ['/r'],
        rules: [
          { from: 'feature', to: 'decision' },
          { from: 'feature', to: 'spec' },
        ],
      }).pipe(Effect.provide(layer)),
    )
    expect(result.missing).toEqual([
      { path: '/r/features/f1.md', rule: { from: 'feature', to: 'decision' } },
      { path: '/r/features/f1.md', rule: { from: 'feature', to: 'spec' } },
    ])
  })

  // Real gap found via adversarial review: my own (from, to)-only dedup fix
  // (see the test above) silently collapsed two rules sharing a kind pair
  // but meaning DIFFERENT things — e.g. issue #28's own worked example,
  // "spec implements decision" and "spec verified_by decision," are
  // distinct obligations, not the same rule twice. `name` (optional)
  // discriminates them; two UNNAMED rules on the same pair still dedupe
  // (that case has no way to express "these are different"), but a NAMED
  // rule is never collapsed with anything but an identically-named one.
  it('treats two rules on the SAME kind pair but with DIFFERENT names as distinct obligations, both reported', async () => {
    const layer = makeTestDocsFs({
      '/r/decisions/d1.md': { content: '# Decision', mtimeMs: 1 },
      '/r/specs/s1.md': { content: '# Spec, no links at all', mtimeMs: 1 },
    })
    const kinds = [
      { id: 'spec', select: { by: 'path' as const, glob: '/r/specs/**' } },
      { id: 'decision', select: { by: 'path' as const, glob: '/r/decisions/**' } },
    ]
    const result = await Effect.runPromise(
      checkCoverage({
        base: '/r',
        kinds,
        roots: ['/r'],
        rules: [
          { from: 'spec', name: 'implements', to: 'decision' },
          { from: 'spec', name: 'verified_by', to: 'decision' },
        ],
      }).pipe(Effect.provide(layer)),
    )
    expect(result.missing).toEqual([
      { path: '/r/specs/s1.md', rule: { from: 'spec', name: 'implements', to: 'decision' } },
      { path: '/r/specs/s1.md', rule: { from: 'spec', name: 'verified_by', to: 'decision' } },
    ])
  })

  it('still dedupes two IDENTICALLY (or both un-)named rules on the same kind pair', async () => {
    const layer = makeTestDocsFs({
      '/r/features/f1.md': { content: '# Feature, no links', mtimeMs: 1 },
    })
    const result = await Effect.runPromise(
      checkCoverage({
        base: '/r',
        kinds: KINDS,
        roots: ['/r'],
        rules: [
          { from: 'feature', name: 'cites', to: 'decision' },
          { from: 'feature', name: 'cites', to: 'decision' },
        ],
      }).pipe(Effect.provide(layer)),
    )
    expect(result.missing).toEqual([
      { path: '/r/features/f1.md', rule: { from: 'feature', name: 'cites', to: 'decision' } },
    ])
  })

  // Adversarial finding, re-running the exact "missing discriminant" review
  // that already caught the (from, to)-only dedup regression once — this
  // time against `via`, which is itself the extension point (see
  // CoverageRequirement's own comment). `via.by` only has one legal value
  // today, so this is unreachable through real config decode, but it's the
  // same latent bug: the moment a second `via.by` variant exists, two rules
  // on the same pair differing ONLY in `via` would silently collapse to
  // one, exactly like the un-named implements/verified_by collision did —
  // reproduced here via a same-shape cast, ahead of that variant landing,
  // so the dedup key can't rot silently in the meantime.
  it('never collapses two same-pair rules that differ only in `via` — the dedup key must track every discriminant, not just `name`', async () => {
    const layer = makeTestDocsFs({
      '/r/features/f1.md': { content: '# Feature, no links', mtimeMs: 1 },
    })
    // `via.by` only has one legal value in the real schema today — the cast
    // simulates the second variant this design already leaves room for
    // (see CoverageRequirementInputSchema's own comment), so the dedup key
    // gets exercised against it before it exists for real.
    const differingOnlyByVia: CoverageRule[] = [
      { from: 'feature', to: 'decision', via: { by: 'link' } },
      { from: 'feature', to: 'decision', via: { by: 'backlink' } } as unknown as CoverageRule,
    ]
    const result = await Effect.runPromise(
      checkCoverage({ base: '/r', kinds: KINDS, roots: ['/r'], rules: differingOnlyByVia }).pipe(Effect.provide(layer)),
    )
    expect(result.missing).toHaveLength(2)
  })

  // Adversarial-review tripwire for the dedup key's object-`to` case: two
  // rules sharing `from` but with STRUCTURALLY DIFFERENT object `to`
  // values must dedupe to two distinct keys, not collapse into one. Pins
  // the dedup key's `JSON.stringify` behavior on object `to` values, so the
  // exact silent-collapse regression this key has already suffered twice
  // (see this file's own dedup-key comment) can't recur a third time
  // unnoticed — now exercised with two REAL variants (`{ external: 'path'
  // }` and `{ external: 'url', pattern }`), not a cast-simulated one.
  it('never collapses two same-`from` rules with structurally different object `to` values', async () => {
    const layer = makeTestDocsFs({
      '/r/specs/s1.md': { content: '# Spec, no links at all', mtimeMs: 1 },
    })
    const specKinds = [{ id: 'spec', select: { by: 'path' as const, glob: '/r/specs/**' } }]
    const differingOnlyByToShape: CoverageRule[] = [
      { from: 'spec', to: { external: 'path' } },
      { from: 'spec', to: { external: 'url', pattern: 'https://example.com/' } },
    ]
    const result = await Effect.runPromise(
      checkCoverage({ base: '/r', kinds: specKinds, roots: ['/r'], rules: differingOnlyByToShape }).pipe(
        Effect.provide(layer),
      ),
    )
    expect(result.missing).toHaveLength(2)
  })

  // Round 4 of the dedup key's own recurring bug (see its file-level
  // comment) — this time caught BEFORE shipping, not after: `scope` is a
  // real, legal field (unlike the `via`/object-`to` tests above, which
  // simulate a not-yet-real variant via cast) — two rules on the same pair
  // differing ONLY in `scope: 'sibling'` vs. unscoped must report as two
  // distinct obligations, not silently collapse to one.
  it('never collapses two same-pair rules that differ only in `scope`', async () => {
    const layer = makeTestDocsFs({
      '/r/features/f1.md': { content: '# Feature, no links', mtimeMs: 1 },
    })
    const differingOnlyByScope: CoverageRule[] = [
      { from: 'feature', to: 'decision' },
      { from: 'feature', scope: 'sibling', to: 'decision' },
    ]
    const result = await Effect.runPromise(
      checkCoverage({ base: '/r', kinds: KINDS, roots: ['/r'], rules: differingOnlyByScope }).pipe(
        Effect.provide(layer),
      ),
    )
    expect(result.missing).toHaveLength(2)
  })

  // Adversarial finding: a chain of rules (feature -> decision -> spec) —
  // 'decision' is BOTH a rule.to (orphan-checkable) AND a rule.from (must
  // itself satisfy its own outbound rule). No special-casing needed; this
  // pins that the design already handles it correctly.
  it('handles a chained relation correctly — a kind that is both a rule.to and a rule.from', async () => {
    const layer = makeTestDocsFs({
      '/r/decisions/d1.md': { content: '# Decision\n\n[spec](../specs/s1.md)', mtimeMs: 1 },
      '/r/features/f1.md': { content: '# Feature\n\n[why](../decisions/d1.md)', mtimeMs: 1 },
      '/r/specs/s1.md': { content: '# Spec', mtimeMs: 1 },
    })
    const chainKinds = [...KINDS, { id: 'spec', select: { by: 'path' as const, glob: '/r/specs/**' } }]
    const result = await Effect.runPromise(
      checkCoverage({
        base: '/r',
        kinds: chainKinds,
        roots: ['/r'],
        rules: [...RULES, { from: 'decision', to: 'spec' }],
      }).pipe(Effect.provide(layer)),
    )
    expect(result.missing).toEqual([])
    expect(result.orphans).toEqual([])
  })

  // Adversarial finding: a direct rule must NOT be satisfied by an
  // indirect/transitive path — matches real traceability semantics (a
  // requirement citing a design doc that cites a test does not itself
  // count as the requirement citing the test).
  it('does not credit transitive coverage for a direct rule', async () => {
    const layer = makeTestDocsFs({
      '/r/decisions/d1.md': { content: '# Decision\n\n[spec](../specs/s1.md)', mtimeMs: 1 },
      '/r/features/f1.md': { content: '# Feature\n\n[why](../decisions/d1.md)', mtimeMs: 1 },
      '/r/specs/s1.md': { content: '# Spec', mtimeMs: 1 },
    })
    const chainKinds = [...KINDS, { id: 'spec', select: { by: 'path' as const, glob: '/r/specs/**' } }]
    const result = await Effect.runPromise(
      checkCoverage({
        base: '/r',
        kinds: chainKinds,
        roots: ['/r'],
        rules: [{ from: 'feature', to: 'spec' }], // direct feature->spec, never satisfied via decision
      }).pipe(Effect.provide(layer)),
    )
    expect(result.missing).toEqual([{ path: '/r/features/f1.md', rule: { from: 'feature', to: 'spec' } }])
  })

  // Adversarial finding: a same-kind cycle (d1 <-> d2) must not hang or
  // misbehave — proves this flat, non-recursive design has no loop-safety
  // concern the way a transitive/recursive structure engine would.
  it('handles a same-kind reference cycle without hanging or misreporting', async () => {
    const layer = makeTestDocsFs({
      '/r/decisions/d1.md': { content: '# D1\n\n[see](./d2.md)', mtimeMs: 1 },
      '/r/decisions/d2.md': { content: '# D2\n\n[see](./d1.md)', mtimeMs: 1 },
    })
    const selfKinds = [{ id: 'decision', select: { by: 'path' as const, glob: '/r/decisions/**' } }]
    const result = await Effect.runPromise(
      checkCoverage({
        base: '/r',
        kinds: selfKinds,
        roots: ['/r'],
        rules: [{ from: 'decision', to: 'decision' }],
      }).pipe(Effect.provide(layer)),
    )
    expect(result.missing).toEqual([])
    expect(result.orphans).toEqual([])
  })

  // Real trap found by dogfooding the built CLI: a kind's glob only
  // classifies docs cairn already scanned — it does NOT implicitly widen
  // `roots`. A kind whose glob falls outside every configured root (or is
  // simply mistyped) matches zero docs, and every rule mentioning it is then
  // vacuously "satisfied" or invisible — `"✅ Coverage OK (0 doc(s)
  // checked)"` looks identical to a genuinely green repo. Surfaced
  // separately (never fatal — a kind can legitimately have zero docs yet,
  // e.g. mid-rollout) so a config mistake is discoverable, not silent.
  it('reports a declared kind that matched zero scanned docs as unmatched — the roots/glob-mismatch trap', async () => {
    const layer = makeTestDocsFs({
      '/r/features/f1.md': { content: '# Feature\n\n[why](../decisions/d1.md)', mtimeMs: 1 },
    })
    const kindsWithATypo = [
      { id: 'feature', select: { by: 'path' as const, glob: '/r/features/**' } },
      { id: 'decision', select: { by: 'path' as const, glob: '/r/decisionz/**' } }, // typo'd glob
    ]
    const result = await Effect.runPromise(
      checkCoverage({ base: '/r', kinds: kindsWithATypo, roots: ['/r'], rules: RULES }).pipe(Effect.provide(layer)),
    )
    expect(result.unmatchedKinds).toEqual(['decision'])
    // Not fatal on its own: only 'decision' is unmatched, 'feature' → nothing
    // resolves (its own link target doesn't exist as a doc), which IS a real
    // missing-coverage finding, but unmatchedKinds itself never drives the
    // exit code (see coverageExitCode's own tests).
  })

  // Issue #28's third v1 check, doc→code reference resolution: a rule whose
  // `to` is `{ external: 'path' }` is satisfied by a link resolving to a
  // REAL FILE on disk — a non-`.md` source file the coverage scan itself
  // never reads as a doc, confirmed via `DocsFs.exists`, not via the
  // scanned-doc graph.
  describe('to: { external: "path" } — doc→code reference resolution', () => {
    const SPEC_KINDS = [{ id: 'spec', select: { by: 'path' as const, glob: '/r/specs/**' } }]
    const EXTERNAL_RULES: CoverageRule[] = [{ from: 'spec', to: { external: 'path' } }]

    it('reports nothing when a spec links to a real, existing file', async () => {
      const layer = makeTestDocsFs({
        '/r/specs/s1.md': { content: '# Spec\n\n[impl](../src/foo.ts)', mtimeMs: 1 },
        '/r/src/foo.ts': { content: 'export const foo = 1', mtimeMs: 1 },
      })
      const result = await Effect.runPromise(
        checkCoverage({ base: '/r', kinds: SPEC_KINDS, roots: ['/r'], rules: EXTERNAL_RULES }).pipe(
          Effect.provide(layer),
        ),
      )
      expect(result.missing).toEqual([])
      expect(coverageExitCode(result)).toBe(0)
    })

    it('reports missing coverage when a spec links to a path that does not exist on disk', async () => {
      const layer = makeTestDocsFs({
        '/r/specs/s1.md': { content: '# Spec\n\n[impl](../src/missing.ts)', mtimeMs: 1 },
      })
      const result = await Effect.runPromise(
        checkCoverage({ base: '/r', kinds: SPEC_KINDS, roots: ['/r'], rules: EXTERNAL_RULES }).pipe(
          Effect.provide(layer),
        ),
      )
      expect(result.missing).toEqual([{ path: '/r/specs/s1.md', rule: { from: 'spec', to: { external: 'path' } } }])
      expect(coverageExitCode(result)).toBe(1)
    })

    it('reports missing coverage for a spec with no links at all', async () => {
      const layer = makeTestDocsFs({ '/r/specs/s1.md': { content: '# Spec, no links', mtimeMs: 1 } })
      const result = await Effect.runPromise(
        checkCoverage({ base: '/r', kinds: SPEC_KINDS, roots: ['/r'], rules: EXTERNAL_RULES }).pipe(
          Effect.provide(layer),
        ),
      )
      expect(result.missing).toEqual([{ path: '/r/specs/s1.md', rule: { from: 'spec', to: { external: 'path' } } }])
    })

    // `{ external: 'path' }` names no kind at all — it must never make its
    // rule's `from` kind eligible for orphan reporting (only a rule's `to`
    // side is ever orphan-checkable, and here `to` isn't a kind).
    it('never treats an external target as an orphan-candidate kind', async () => {
      const layer = makeTestDocsFs({
        '/r/specs/s1.md': { content: '# Spec\n\n[impl](../src/foo.ts)', mtimeMs: 1 },
        '/r/src/foo.ts': { content: 'export const foo = 1', mtimeMs: 1 },
      })
      const result = await Effect.runPromise(
        checkCoverage({ base: '/r', kinds: SPEC_KINDS, roots: ['/r'], rules: EXTERNAL_RULES }).pipe(
          Effect.provide(layer),
        ),
      )
      expect(result.orphans).toEqual([])
    })

    // A directory existing on disk isn't a satisfying reference — `exists`
    // is true for directories too (see DocsFs.ts), but a rule asking for a
    // real FILE reference shouldn't be silently satisfied by a directory
    // link. Documented here as current behavior: `resolveRuleEdges` only
    // asks "does this path exist," matching plain link-checking's own
    // target-existence semantics — no separate is-a-file check exists yet.
    it('is satisfied by a link to an existing directory too, matching DocsFs.exists own semantics', async () => {
      const layer = makeTestDocsFs({
        '/r/specs/s1.md': { content: '# Spec\n\n[impl](../src/)', mtimeMs: 1 },
        '/r/src/foo.ts': { content: 'export const foo = 1', mtimeMs: 1 },
      })
      const result = await Effect.runPromise(
        checkCoverage({ base: '/r', kinds: SPEC_KINDS, roots: ['/r'], rules: EXTERNAL_RULES }).pipe(
          Effect.provide(layer),
        ),
      )
      expect(result.missing).toEqual([])
    })

    // Adversarial finding, security-relevant: a link resolving OUTSIDE
    // `base` (`../../../etc/hostname`) must never be stat'd/read on the
    // real filesystem at all — the observable signal (missing coverage)
    // must be constant regardless of what's actually there, matching
    // `CheckLinks.ts`'s own "never touches the filesystem for a target
    // resolving outside `base`" guarantee (issue #39). Without this, a
    // doc could "satisfy" a required coverage rule by linking to any file
    // that happens to exist outside the repo entirely, and cairn becomes a
    // filesystem-existence oracle for an untrusted PR's link target.
    it('never touches the filesystem for an external-path candidate resolving outside `base`, and never treats it as satisfying', async () => {
      const files: Record<string, string> = {
        '/r/specs/s1.md': '# Spec\n\n[escape](../../../etc/hostname)',
      }
      let outsideBaseTouched = false
      const guard = (abs: string): void => {
        if (!abs.startsWith('/r/')) {
          outsideBaseTouched = true
        }
      }
      const service: DocsFsService = {
        deleteFile: () => Effect.succeed(undefined),
        exists: (abs) => {
          guard(abs)
          return Effect.succeed(true)
        },
        listFiles: () => Effect.succeed(Object.keys(files)),
        readFile: (abs) => {
          guard(abs)
          return Effect.succeed(files[abs] ?? '')
        },
        realPath: (abs) => {
          guard(abs)
          // Even if this DID physically resolve, the guard above proves it
          // was never asked — but answer non-null anyway so a bug that
          // skips the guard still fails the assertion below on the real
          // signal, not just on the spy.
          return Effect.succeed(abs)
        },
        stat: () => Effect.die('not used in this test'),
        writeFile: () => Effect.succeed(undefined),
      }
      const layer = Layer.succeed(DocsFs, service)
      const result = await Effect.runPromise(
        checkCoverage({ base: '/r', kinds: SPEC_KINDS, roots: ['/r'], rules: EXTERNAL_RULES }).pipe(
          Effect.provide(layer),
        ),
      )
      expect(outsideBaseTouched).toBeFalsy()
      expect(result.missing).toEqual([{ path: '/r/specs/s1.md', rule: { from: 'spec', to: { external: 'path' } } }])
    })

    // Adversarial finding, security-relevant (second round): a candidate
    // whose OWN path is lexically within `base` can still be a SYMLINK
    // whose real, resolved target lives outside it — `isWithinBase` alone
    // can't see this, since it never resolves the link. `realPath` must be
    // re-checked against `base` too, not just the candidate's lexical path.
    it('never treats a symlink whose real target escapes `base` as satisfying, even though its own path is lexically in-base', async () => {
      const files: Record<string, string> = {
        '/r/specs/s1.md': '# Spec\n\n[escape](../link-to-outside)',
      }
      const service: DocsFsService = {
        deleteFile: () => Effect.succeed(undefined),
        exists: () => Effect.succeed(true),
        listFiles: () => Effect.succeed(Object.keys(files)),
        readFile: (abs) => Effect.succeed(files[abs] ?? ''),
        // The symlink's OWN path (`/r/link-to-outside`) is lexically inside
        // `/r` — `isWithinBase` on the candidate alone would pass. Its
        // REAL target is outside `base` entirely.
        realPath: (abs) => Effect.succeed(abs === '/r/link-to-outside' ? '/etc/secret' : abs),
        stat: () => Effect.die('not used in this test'),
        writeFile: () => Effect.succeed(undefined),
      }
      const layer = Layer.succeed(DocsFs, service)
      const result = await Effect.runPromise(
        checkCoverage({ base: '/r', kinds: SPEC_KINDS, roots: ['/r'], rules: EXTERNAL_RULES }).pipe(
          Effect.provide(layer),
        ),
      )
      expect(result.missing).toEqual([{ path: '/r/specs/s1.md', rule: { from: 'spec', to: { external: 'path' } } }])
    })

    it('is still satisfied when realPath resolves to the SAME in-base path (the common, non-symlink case)', async () => {
      const layer = makeTestDocsFs({
        '/r/specs/s1.md': { content: '# Spec\n\n[impl](../src/foo.ts)', mtimeMs: 1 },
        '/r/src/foo.ts': { content: 'export const foo = 1', mtimeMs: 1 },
      })
      const result = await Effect.runPromise(
        checkCoverage({ base: '/r', kinds: SPEC_KINDS, roots: ['/r'], rules: EXTERNAL_RULES }).pipe(
          Effect.provide(layer),
        ),
      )
      expect(result.missing).toEqual([])
    })
  })

  // The gap `{ external: 'url', pattern }` closes (docs/design/
  // CONVENTION.md, docs/adr/0005): a rule can now require a link to an
  // EXTERNAL URL (e.g. a GitHub issue), not just to a scanned doc or a real
  // file. Purely content-based — no filesystem IO at all, unlike the
  // `{ external: 'path' }` block above.
  describe('to: { external: "url", pattern } — a link matching an external URL pattern', () => {
    const SPEC_KINDS = [{ id: 'spec', select: { by: 'path' as const, glob: '/r/specs/**' } }]
    const URL_RULES: CoverageRule[] = [
      { from: 'spec', to: { external: 'url', pattern: 'https://github.com/example/repo/issues/' } },
    ]

    it('reports nothing when a spec links to a URL matching the pattern', async () => {
      const layer = makeTestDocsFs({
        '/r/specs/s1.md': { content: '# Spec\n\nSee [issue](https://github.com/example/repo/issues/101).', mtimeMs: 1 },
      })
      const result = await Effect.runPromise(
        checkCoverage({ base: '/r', kinds: SPEC_KINDS, roots: ['/r'], rules: URL_RULES }).pipe(Effect.provide(layer)),
      )
      expect(result.missing).toEqual([])
      expect(coverageExitCode(result)).toBe(0)
    })

    // FALSIFIED: ran once with the issue link present (green, above) and
    // once with it removed entirely (this test, red without the fix) —
    // confirms the rule actually discriminates rather than always passing.
    it('reports missing coverage when a spec has no link matching the pattern', async () => {
      const layer = makeTestDocsFs({ '/r/specs/s1.md': { content: '# Spec, no links at all', mtimeMs: 1 } })
      const result = await Effect.runPromise(
        checkCoverage({ base: '/r', kinds: SPEC_KINDS, roots: ['/r'], rules: URL_RULES }).pipe(Effect.provide(layer)),
      )
      expect(result.missing).toEqual([
        {
          path: '/r/specs/s1.md',
          rule: { from: 'spec', to: { external: 'url', pattern: 'https://github.com/example/repo/issues/' } },
        },
      ])
      expect(coverageExitCode(result)).toBe(1)
    })

    it('reports missing coverage when a spec links to a URL that does NOT match the pattern', async () => {
      const layer = makeTestDocsFs({
        '/r/specs/s1.md': { content: '# Spec\n\nSee [other](https://github.com/other/repo/issues/1).', mtimeMs: 1 },
      })
      const result = await Effect.runPromise(
        checkCoverage({ base: '/r', kinds: SPEC_KINDS, roots: ['/r'], rules: URL_RULES }).pipe(Effect.provide(layer)),
      )
      expect(result.missing).toHaveLength(1)
    })

    // `{ external: 'url', pattern }` names no kind at all — same as
    // `{ external: 'path' }`, it must never make its rule's `from` kind
    // eligible for orphan reporting.
    it('never treats a url-pattern target as an orphan-candidate kind', async () => {
      const layer = makeTestDocsFs({
        '/r/specs/s1.md': { content: '# Spec\n\nSee [issue](https://github.com/example/repo/issues/101).', mtimeMs: 1 },
      })
      const result = await Effect.runPromise(
        checkCoverage({ base: '/r', kinds: SPEC_KINDS, roots: ['/r'], rules: URL_RULES }).pipe(Effect.provide(layer)),
      )
      expect(result.orphans).toEqual([])
    })

    // No filesystem call is even possible here — unlike `{ external: 'path'
    // }`, `collectExternalRefTargets` never collects a candidate for a
    // url-only rule (see ../../core/structure/Coverage.unit.test.ts), so
    // there is nothing for `DocsFs.exists`/`realPath` to be asked about.
    // This test only pins that a url-pattern rule is satisfied by CONTENT
    // matching alone, with no dependency on `base`/`DocsFs` semantics.
    it('is satisfied by content matching alone, independent of `base`', async () => {
      const layer = makeTestDocsFs({
        '/r/specs/s1.md': { content: '# Spec\n\nSee [issue](https://github.com/example/repo/issues/101).', mtimeMs: 1 },
      })
      const result = await Effect.runPromise(
        checkCoverage({ base: '/does/not/exist', kinds: SPEC_KINDS, roots: ['/r'], rules: URL_RULES }).pipe(
          Effect.provide(layer),
        ),
      )
      expect(result.missing).toEqual([])
    })
  })

  it('never reports a kind that matched at least one doc as unmatched', async () => {
    const layer = makeTestDocsFs({
      '/r/decisions/d1.md': { content: '# Decision', mtimeMs: 1 },
      '/r/features/f1.md': { content: '# Feature\n\n[why](../decisions/d1.md)', mtimeMs: 1 },
    })
    const result = await Effect.runPromise(
      checkCoverage({ base: '/r', kinds: KINDS, roots: ['/r'], rules: RULES }).pipe(Effect.provide(layer)),
    )
    expect(result.unmatchedKinds).toEqual([])
  })
})

describe('coverageExitCode()', () => {
  it('is 0 when both missing and orphans are empty', () => {
    expect(coverageExitCode({ checked: 1, missing: [], orphans: [], unmatchedKinds: [] })).toBe(0)
  })

  // unmatchedKinds is a config-mistake hint (see checkCoverage's own test),
  // not a violation — a kind can legitimately have zero docs mid-rollout, so
  // its presence alone must never flip the exit code the way missing/orphans
  // findings do.
  it('is 0 when unmatchedKinds is non-empty but missing and orphans are both empty', () => {
    expect(coverageExitCode({ checked: 1, missing: [], orphans: [], unmatchedKinds: ['decision'] })).toBe(0)
  })

  it('is 1 when only missing is non-empty (orphans empty)', () => {
    expect(
      coverageExitCode({
        checked: 1,
        missing: [{ path: '/r/f.md', rule: { from: 'a', to: 'b' } }],
        orphans: [],
        unmatchedKinds: [],
      }),
    ).toBe(1)
  })

  it('is 1 when only orphans is non-empty (missing empty)', () => {
    expect(
      coverageExitCode({ checked: 1, missing: [], orphans: [{ kinds: ['a'], path: '/r/d.md' }], unmatchedKinds: [] }),
    ).toBe(1)
  })
})

describe('coverageExitCode() — unmatchedKinds never contributes on its own', () => {
  it('is still 1 when unmatchedKinds is non-empty alongside a real missing finding', () => {
    expect(
      coverageExitCode({
        checked: 1,
        missing: [{ path: '/r/f.md', rule: { from: 'a', to: 'b' } }],
        orphans: [],
        unmatchedKinds: ['b'],
      }),
    ).toBe(1)
  })
})

describe('formatCoverageReport()', () => {
  it('reports OK with the checked count when both missing and orphans are empty', () => {
    expect(formatCoverageReport({ checked: 3, missing: [], orphans: [], unmatchedKinds: [] })).toEqual([
      '✅ Coverage OK (3 doc(s) checked).',
    ])
  })

  it('appends an unmatched-kind warning even on an otherwise-OK report — the roots/glob-mismatch trap must not look silently green', () => {
    const lines = formatCoverageReport({ checked: 1, missing: [], orphans: [], unmatchedKinds: ['decision'] })
    expect(lines).toEqual([
      '✅ Coverage OK (1 doc(s) checked).',
      '⚠️  kind "decision" matched 0 scanned docs — check its glob against `roots`, or that it is simply not typo\'d.',
    ])
  })

  it('lists every unmatched kind, one line each, alongside real findings too', () => {
    const lines = formatCoverageReport({
      checked: 1,
      missing: [{ path: '/r/features/f1.md', rule: { from: 'feature', to: 'decision' } }],
      orphans: [],
      unmatchedKinds: ['decision', 'spec'],
    })
    expect(lines.filter((l) => l.startsWith('⚠️'))).toEqual([
      '⚠️  kind "decision" matched 0 scanned docs — check its glob against `roots`, or that it is simply not typo\'d.',
      '⚠️  kind "spec" matched 0 scanned docs — check its glob against `roots`, or that it is simply not typo\'d.',
    ])
  })

  it('lists every missing-coverage and orphan finding, exact wording', () => {
    const lines = formatCoverageReport({
      checked: 2,
      missing: [{ path: '/r/features/f1.md', rule: { from: 'feature', to: 'decision' } }],
      orphans: [{ kinds: ['decision'], path: '/r/decisions/d1.md' }],
      unmatchedKinds: [],
    })
    expect(lines).toEqual([
      '❌ 1 doc(s) missing required coverage:',
      '  /r/features/f1.md',
      '    ✗ no link to a "decision"-kind doc (required by kind "feature")',
      '❌ 1 orphan doc(s) — no inbound reference from anywhere in the corpus:',
      '  /r/decisions/d1.md (decision)',
    ])
  })

  it('includes the rule name, quoted, when the missing rule has one', () => {
    const lines = formatCoverageReport({
      checked: 1,
      missing: [{ path: '/r/specs/s1.md', rule: { from: 'spec', name: 'implements', to: 'decision' } }],
      orphans: [],
      unmatchedKinds: [],
    })
    expect(lines).toEqual([
      '❌ 1 doc(s) missing required coverage:',
      '  /r/specs/s1.md',
      '    ✗ no link ("implements") to a "decision"-kind doc (required by kind "spec")',
    ])
  })

  it('omits the name suffix entirely when the missing rule has none, not an empty pair of parens', () => {
    const lines = formatCoverageReport({
      checked: 1,
      missing: [{ path: '/r/specs/s1.md', rule: { from: 'spec', to: 'decision' } }],
      orphans: [],
      unmatchedKinds: [],
    })
    expect(lines).toContain('    ✗ no link to a "decision"-kind doc (required by kind "spec")')
  })

  // Real gap found refuting whether this schema's own vocabulary
  // (`name` values like `grounded_by`) actually guides anyone: `name` alone
  // only ever fed a disambiguating label into the report, with no
  // explanation of what it means — `description` closes that for real.
  it('renders the rule’s `description`, when present, as guidance right after the missing-coverage line', () => {
    const lines = formatCoverageReport({
      checked: 1,
      missing: [
        {
          path: '/r/design/pkg/solution-space.md',
          rule: {
            description: 'A cost/feasibility claim needs real evidence — cite the spike that backs it.',
            from: 'solution-space',
            name: 'grounded_by',
            to: 'spikes',
          },
        },
      ],
      orphans: [],
      unmatchedKinds: [],
    })
    expect(lines).toEqual([
      '❌ 1 doc(s) missing required coverage:',
      '  /r/design/pkg/solution-space.md',
      '    ✗ no link ("grounded_by") to a "spikes"-kind doc (required by kind "solution-space")',
      '      A cost/feasibility claim needs real evidence — cite the spike that backs it.',
    ])
  })

  it('omits the guidance line entirely when the missing rule has no `description`, not a blank line', () => {
    const lines = formatCoverageReport({
      checked: 1,
      missing: [{ path: '/r/specs/s1.md', rule: { from: 'spec', to: 'decision' } }],
      orphans: [],
      unmatchedKinds: [],
    })
    expect(lines).toEqual([
      '❌ 1 doc(s) missing required coverage:',
      '  /r/specs/s1.md',
      '    ✗ no link to a "decision"-kind doc (required by kind "spec")',
    ])
  })

  it('joins multiple kinds with ", " on an orphan finding — distinguishes from a bare concatenation', () => {
    const lines = formatCoverageReport({
      checked: 1,
      missing: [],
      orphans: [{ kinds: ['decision', 'internal'], path: '/r/decisions/d1.md' }],
      unmatchedKinds: [],
    })
    expect(lines).toContain('  /r/decisions/d1.md (decision, internal)')
  })

  it('reports a `to: { external: "path" }` missing-coverage finding with its own wording, English and French', () => {
    const missing = [{ path: '/r/specs/s1.md', rule: { from: 'spec', to: { external: 'path' as const } } }]
    const enLines = formatCoverageReport({ checked: 1, missing, orphans: [], unmatchedKinds: [] })
    expect(enLines).toContain('    ✗ no link to an existing file (required by kind "spec")')
    const frLines = formatCoverageReport({ checked: 1, missing, orphans: [], unmatchedKinds: [] }, { locale: 'fr' })
    expect(frLines).toContain('    ✗ aucun lien vers un fichier existant (requis pour le type « spec »)')
  })

  it('reports a `to: { external: "url", pattern } }` missing-coverage finding with its own wording, English and French', () => {
    const missing = [
      {
        path: '/r/specs/s1.md',
        rule: { from: 'spec', to: { external: 'url' as const, pattern: 'https://github.com/example/repo/issues/' } },
      },
    ]
    const enLines = formatCoverageReport({ checked: 1, missing, orphans: [], unmatchedKinds: [] })
    expect(enLines).toContain(
      '    ✗ no link matching "https://github.com/example/repo/issues/" (required by kind "spec")',
    )
    const frLines = formatCoverageReport({ checked: 1, missing, orphans: [], unmatchedKinds: [] }, { locale: 'fr' })
    expect(frLines).toContain(
      '    ✗ aucun lien correspondant à « https://github.com/example/repo/issues/ » (requis pour le type « spec »)',
    )
  })

  it('lists a missing-coverage finding with no orphan section at all when orphans is empty', () => {
    const lines = formatCoverageReport({
      checked: 1,
      missing: [{ path: '/r/features/f1.md', rule: { from: 'feature', to: 'decision' } }],
      orphans: [],
      unmatchedKinds: [],
    })
    expect(lines.some((l) => l.includes('/r/features/f1.md'))).toBeTruthy()
    expect(lines.some((l) => l.includes('orphan'))).toBeFalsy()
  })

  it('lists an orphan finding with no missing-coverage section at all when missing is empty', () => {
    const lines = formatCoverageReport({
      checked: 1,
      missing: [],
      orphans: [{ kinds: ['decision'], path: '/r/decisions/d1.md' }],
      unmatchedKinds: [],
    })
    expect(lines.some((l) => l.includes('/r/decisions/d1.md'))).toBeTruthy()
    expect(lines.some((l) => l.includes('missing required coverage'))).toBeFalsy()
  })

  it('reports in French when locale is "fr" — both the OK line and every finding class', () => {
    expect(
      formatCoverageReport({ checked: 1, missing: [], orphans: [], unmatchedKinds: [] }, { locale: 'fr' }),
    ).toEqual(['✅ Couverture OK (1 document(s) vérifié(s)).'])
    const lines = formatCoverageReport(
      {
        checked: 2,
        missing: [{ path: '/r/features/f1.md', rule: { from: 'feature', to: 'decision' } }],
        orphans: [{ kinds: ['decision'], path: '/r/decisions/d1.md' }],
        unmatchedKinds: [],
      },
      { locale: 'fr' },
    )
    expect(lines.some((l) => l.includes('sans la couverture requise'))).toBeTruthy()
    expect(lines.some((l) => l.includes('aucun lien vers un document de type'))).toBeTruthy()
    expect(lines.some((l) => l.includes('orphelin'))).toBeTruthy()
  })

  it('reports the unmatched-kind warning in French too', () => {
    const lines = formatCoverageReport(
      { checked: 1, missing: [], orphans: [], unmatchedKinds: ['decision'] },
      { locale: 'fr' },
    )
    expect(lines.some((l) => l.includes('n’a correspondu à aucun document'))).toBeTruthy()
  })
})
