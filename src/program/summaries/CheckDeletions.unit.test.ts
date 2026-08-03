import { expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { describe } from 'vitest'

import { GitUnavailableError, makeTestGitFs } from '../../io/Git.ts'
import { makeTestDocsFs } from '../../io/DocsFs.ts'
import { checkDeletions, deletionsExitCode, formatDeletionsReport } from './CheckDeletions.ts'

const layers = (
  files: Record<string, { content: string; mtimeMs: number }>,
  deletedSince: readonly string[] | GitUnavailableError,
  atRef: ReadonlyMap<string, string> = new Map(),
) => Layer.merge(makeTestDocsFs(files), makeTestGitFs(new Set(), [], [], atRef, deletedSince))

it.layer(
  layers(
    {
      '/r/docs/kept.md': { content: '# Kept\n\nUnrelated.', mtimeMs: 1 },
      // Exercises readMarkdownCorpus's own skip conditions: a non-.md file
      // (never even a candidate) and an ignored .md file, alongside the
      // real kept.md doc that must still be read normally.
      '/r/docs/notes.txt': { content: 'not markdown', mtimeMs: 1 },
      '/r/docs/vendor/generated.md': { content: '### Vendor Heading', mtimeMs: 1 },
    },
    ['/r/docs/old.md'],
    new Map([['/r/docs/old.md', '### Unique Section\n\nSome prose.']]),
  ),
)('checkDeletions() — a deleted doc with content found nowhere else', (layerIt) => {
  layerIt.effect('reports it, and counts it as checked', () =>
    Effect.gen(function* () {
      const result = yield* checkDeletions({ base: '/r', ignore: ['**/vendor/**'], ref: 'HEAD', roots: ['/r/docs'] })
      expect(result.checked).toBe(1)
      expect(result.findings).toEqual([
        {
          orphanedHeadings: ['### Unique Section'],
          orphanedLinkTargets: [],
          path: '/r/docs/old.md',
        },
      ])
      expect(deletionsExitCode(result)).toBe(0)
    }),
  )
})

it.layer(
  layers(
    { '/r/docs/kept.md': { content: '# Kept\n\n### Shared\n\nStill here.', mtimeMs: 1 } },
    ['/r/docs/old.md'],
    new Map([['/r/docs/old.md', '### Shared\n\nSome prose.']]),
  ),
)('checkDeletions() — a deleted doc whose content survives elsewhere', (layerIt) => {
  layerIt.effect('reports no findings, but still counts the deletion as checked', () =>
    Effect.gen(function* () {
      const result = yield* checkDeletions({ base: '/r', ref: 'HEAD', roots: ['/r/docs'] })
      expect(result.checked).toBe(1)
      expect(result.findings).toEqual([])
    }),
  )
})

it.layer(
  layers({}, ['/r/other/outside-root.md'], new Map([['/r/other/outside-root.md', '### Outside\n\nNot in scope.']])),
)('checkDeletions() — a deleted path outside every configured root', (layerIt) => {
  layerIt.effect('is excluded entirely, not read or reported', () =>
    Effect.gen(function* () {
      const result = yield* checkDeletions({ base: '/r', ref: 'HEAD', roots: ['/r/docs'] })
      expect(result.checked).toBe(0)
      expect(result.findings).toEqual([])
    }),
  )
})

it.layer(
  layers(
    {},
    ['/r/docs/vendor/generated.md'],
    new Map([['/r/docs/vendor/generated.md', '### Vendor\n\nGenerated content.']]),
  ),
)('checkDeletions() — a deleted path matched by ignore', (layerIt) => {
  layerIt.effect('is excluded entirely, not read or reported', () =>
    Effect.gen(function* () {
      const result = yield* checkDeletions({
        base: '/r',
        ignore: ['**/vendor/**'],
        ref: 'HEAD',
        roots: ['/r/docs'],
      })
      expect(result.checked).toBe(0)
      expect(result.findings).toEqual([])
    }),
  )
})

it.layer(
  layers(
    {},
    ['/r/docs/old.summary.md', '/r/docs/_SUMMARY.md'],
    new Map([
      ['/r/docs/old.summary.md', '### Summary Heading'],
      ['/r/docs/_SUMMARY.md', '### Dir Summary Heading'],
    ]),
  ),
)('checkDeletions() — a deleted summary artifact (file or directory summary)', (layerIt) => {
  layerIt.effect("is excluded — its deletion is orphanStamps/findOrphans' concern, not this one's", () =>
    Effect.gen(function* () {
      const result = yield* checkDeletions({ base: '/r', ref: 'HEAD', roots: ['/r/docs'] })
      expect(result.checked).toBe(0)
      expect(result.findings).toEqual([])
    }),
  )
})

// Issue #106 adversarial review (second pass): `listDeletedSince` already
// succeeding means `ref` itself is good — a PER-PATH `readFileAtRef`
// failure after that (a corrupt object for one specific blob) must degrade
// gracefully, the same leniency `readMarkdownCorpus` already gives an
// unreadable file in the CURRENT corpus. Otherwise one corrupt deleted doc
// would cost every OTHER deleted doc's otherwise-perfectly-detectable
// finding too — confirmed as a real regression by direct testing before
// this fix.
it.layer(
  layers(
    { '/r/docs/kept.md': { content: 'Nothing relevant.', mtimeMs: 1 } },
    ['/r/docs/corrupt.md', '/r/docs/old.md'],
    new Map([['/r/docs/old.md', '### Unique Section\n\nOnly description of this feature anywhere.']]),
  ),
)(
  "checkDeletions() — one deleted doc's content is not recoverable at the ref, alongside another that IS",
  (layerIt) => {
    layerIt.effect(
      "skips just the unrecoverable one, still reporting the other's finding, and NAMES the skip (never silent — matches CheckLinks.ts's own unreadable-file precedent)",
      () =>
        Effect.gen(function* () {
          const result = yield* checkDeletions({ base: '/r', ref: 'HEAD', roots: ['/r/docs'] })
          expect(result.checked).toBe(1)
          expect(result.findings).toEqual([
            {
              orphanedHeadings: ['### Unique Section'],
              orphanedLinkTargets: [],
              path: '/r/docs/old.md',
            },
          ])
          expect(result.skipped).toEqual(['/r/docs/corrupt.md'])
        }),
    )
  },
)

// Issue #93 DRY audit: `readMarkdownCorpus` (io/DocsFs.ts, shared with
// CheckSummaries.ts/CheckRefs.ts/CheckProseRefs.ts/CheckCoverage.ts)
// re-checks `ignore` at the file level (issue #102's fix) when building
// `remainingFiles` — necessary here specifically, unlike for
// CheckSummaries.ts, since nothing downstream re-filters this map. A bare
// filename pattern with no leading `**/`/no `/` at all only matches a file
// directly, never a directory ancestor, so `dfs.listFiles`'s own
// directory-based ignore pruning can't be the one doing the work here.
it.layer(
  layers(
    { '/r/docs/SKIP.md': { content: '### Unique Section\n\nOnly here, but ignored.', mtimeMs: 1 } },
    ['/r/docs/old.md'],
    new Map([['/r/docs/old.md', '### Unique Section\n\nSame heading, ignored doc must not count as survival.']]),
  ),
)(
  'checkDeletions() — an ignored remaining file (bare filename pattern) does not count as "content survives"',
  (layerIt) => {
    layerIt.effect('still reports the deleted content as orphaned', () =>
      Effect.gen(function* () {
        const result = yield* checkDeletions({ base: '/r', ignore: ['SKIP.md'], ref: 'HEAD', roots: ['/r/docs'] })
        expect(result.findings).toEqual([
          {
            orphanedHeadings: ['### Unique Section'],
            orphanedLinkTargets: [],
            path: '/r/docs/old.md',
          },
        ])
      }),
    )
  },
)

it.layer(layers({}, new GitUnavailableError({ base: '/r', message: 'boom' })))(
  'checkDeletions() — git unavailable',
  (layerIt) => {
    layerIt.effect('propagates the GitUnavailableError', () =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(checkDeletions({ base: '/r', ref: 'HEAD', roots: ['/r/docs'] }))
        expect(error).toBeInstanceOf(GitUnavailableError)
      }),
    )
  },
)

it.layer(
  layers(
    { '/r/docs/kept.md': { content: 'Nothing relevant.', mtimeMs: 1 } },
    ['/r/docs/plain.md'],
    new Map([['/r/docs/plain.md', 'Just prose, no headings, no links.']]),
  ),
)('checkDeletions() — a deleted doc with no headings and no links at all', (layerIt) => {
  layerIt.effect('is still counted as checked, but produces no finding', () =>
    Effect.gen(function* () {
      const result = yield* checkDeletions({ base: '/r', ref: 'HEAD', roots: ['/r/docs'] })
      expect(result.checked).toBe(1)
      expect(result.findings).toEqual([])
    }),
  )
})

// Issue #106 "best value defaults" audit: every sibling check
// (CheckSummaries.ts, CheckLinks.ts, CheckRefs.ts, CheckProseRefs.ts,
// CheckCoverage.ts) narrows its scanned-doc universe to `trackedFiles`
// when `onlyGitTracked` is on, for CI parity — a fresh checkout never
// sees an untracked scratch file. `checkDeletions` didn't, which is a
// real CI-parity gap in the opposite direction from every other check's
// own bug class: an UNTRACKED scratch doc could make a genuinely-orphaned
// heading look like it "survives" (via the untracked file), producing a
// FALSE NEGATIVE that a real CI run (which never sees that file) would
// not reproduce.
it.layer(
  layers(
    {
      // Untracked (not in `trackedFiles` below) — a fresh CI checkout
      // would never see this, so it must NOT count as "surviving"
      // content once `onlyGitTracked` is respected.
      '/r/docs/scratch.md': { content: '### Unique Section', mtimeMs: 1 },
    },
    ['/r/docs/old.md'],
    new Map([['/r/docs/old.md', '### Unique Section\n\nSome prose.']]),
  ),
)('checkDeletions() — onlyGitTracked / trackedFiles narrowing (CI parity)', (layerIt) => {
  layerIt.effect(
    'an untracked scratch doc does not count as "surviving" content when trackedFiles narrows the corpus',
    () =>
      Effect.gen(function* () {
        const result = yield* checkDeletions({
          base: '/r',
          ref: 'HEAD',
          roots: ['/r/docs'],
          trackedFiles: new Set(), // scratch.md is untracked — excluded
        })
        expect(result.findings).toEqual([
          {
            orphanedHeadings: ['### Unique Section'],
            orphanedLinkTargets: [],
            path: '/r/docs/old.md',
          },
        ])
      }),
  )

  layerIt.effect('without trackedFiles narrowing (default), the untracked scratch doc masks the same finding', () =>
    Effect.gen(function* () {
      const result = yield* checkDeletions({ base: '/r', ref: 'HEAD', roots: ['/r/docs'] })
      expect(result.findings).toEqual([])
    }),
  )
})

describe('formatDeletionsReport() / deletionsExitCode()', () => {
  it('formatDeletionsReport() reports success when nothing is orphaned', () => {
    const lines = formatDeletionsReport({ checked: 3, findings: [], skipped: [] })
    expect(lines).toEqual(['✅ No orphaned content found (3 deletion(s) checked).'])
  })

  // Issue #106 "best value defaults" audit, round 6: every sibling
  // formatter (formatLinkReport, formatSummaryReport, formatCoverageReport)
  // has an explicit `locale: 'fr'` test — formatDeletionsReport was the
  // only one that didn't, across ALL of its branches (success, "nothing to
  // check", findings, skipped).
  it('localises every branch to French when asked', () => {
    expect(formatDeletionsReport({ checked: 3, findings: [], skipped: [] }, { locale: 'fr' })).toEqual([
      '✅ Aucun contenu orphelin trouvé (3 suppression(s) vérifiée(s)).',
    ])

    expect(formatDeletionsReport({ checked: 0, findings: [], skipped: [] }, { locale: 'fr' })).toEqual([
      "ℹ️  Rien n'a été supprimé depuis la référence comparée — rien à vérifier. Passez --deletions-since <ref> (par ex. une branche de base de PR) pour vérifier les suppressions déjà commises sur cette branche.",
    ])

    expect(
      formatDeletionsReport(
        {
          checked: 1,
          findings: [
            {
              orphanedHeadings: ['### Section unique'],
              orphanedLinkTargets: ['/r/src/program/links/CheckRefs.ts'],
              path: '/r/docs/old.md',
            },
          ],
          skipped: [],
        },
        { locale: 'fr' },
      ),
    ).toEqual([
      '⚠️  1 document(s) supprimé(s) ont emporté du contenu introuvable ailleurs :',
      '  /r/docs/old.md',
      '    titre introuvable ailleurs: ### Section unique',
      '    cible de lien introuvable ailleurs: /r/src/program/links/CheckRefs.ts',
    ])

    expect(
      formatDeletionsReport({ checked: 1, findings: [], skipped: ['/r/docs/corrupt.md'] }, { locale: 'fr' }),
    ).toEqual([
      '✅ Aucun contenu orphelin trouvé (1 suppression(s) vérifiée(s)).',
      "⚠️  1 document(s) supprimé(s) n'ont pas pu être relus à cette référence (peut-être corrompus) — non vérifiés :",
      '  /r/docs/corrupt.md',
    ])
  })

  // Issue #106 "best value defaults" audit: `checked: 0` (nothing deleted
  // since the compared ref at all — the common case for a bare local run
  // against the default HEAD) must read differently from `checked: 3` (3
  // deletions actually compared, none orphaned) — an unqualified ✅ for
  // both would misleadingly imply verification happened when it didn't.
  it('formatDeletionsReport() distinguishes "nothing to check" from "checked N, all clean"', () => {
    const nothingToCheck = formatDeletionsReport({ checked: 0, findings: [], skipped: [] })
    expect(nothingToCheck).toEqual([
      'ℹ️  Nothing deleted since the compared ref — nothing to check. Pass --deletions-since <ref> (e.g. a PR base branch) to check deletions already committed on this branch.',
    ])
    expect(nothingToCheck[0]).not.toContain('✅')

    const verifiedClean = formatDeletionsReport({ checked: 3, findings: [], skipped: [] })
    expect(verifiedClean).toEqual(['✅ No orphaned content found (3 deletion(s) checked).'])
  })

  it('formatDeletionsReport() names the orphaned heading/link target per deleted doc', () => {
    const lines = formatDeletionsReport({
      checked: 1,
      findings: [
        {
          orphanedHeadings: ['### Unique Section'],
          orphanedLinkTargets: ['/r/src/program/links/CheckRefs.ts'],
          path: '/r/docs/old.md',
        },
      ],
      skipped: [],
    })
    expect(lines).toEqual([
      '⚠️  1 deleted doc(s) took content with them, found nowhere else:',
      '  /r/docs/old.md',
      '    heading nowhere else: ### Unique Section',
      '    link target nowhere else: /r/src/program/links/CheckRefs.ts',
    ])
  })

  // Issue #106 "best value defaults" audit: a skipped (unrecoverable)
  // deleted doc must never be silently absorbed — matches CheckLinks.ts's
  // own established `unreadable` precedent. Both branches (nothing
  // orphaned; something orphaned) must still surface it.
  it('formatDeletionsReport() names a skipped (unrecoverable) deleted doc, never silently', () => {
    const withoutFindings = formatDeletionsReport({ checked: 1, findings: [], skipped: ['/r/docs/corrupt.md'] })
    expect(withoutFindings).toEqual([
      '✅ No orphaned content found (1 deletion(s) checked).',
      '⚠️  1 deleted doc(s) could not be read back at the ref (possibly corrupt) — not checked:',
      '  /r/docs/corrupt.md',
    ])

    const withFindings = formatDeletionsReport({
      checked: 1,
      findings: [{ orphanedHeadings: ['### X'], orphanedLinkTargets: [], path: '/r/docs/old.md' }],
      skipped: ['/r/docs/corrupt.md'],
    })
    expect(withFindings).toEqual([
      '⚠️  1 deleted doc(s) took content with them, found nowhere else:',
      '  /r/docs/old.md',
      '    heading nowhere else: ### X',
      '⚠️  1 deleted doc(s) could not be read back at the ref (possibly corrupt) — not checked:',
      '  /r/docs/corrupt.md',
    ])
  })

  it('deletionsExitCode() always returns 0, regardless of findings or skipped — informational only', () => {
    expect(deletionsExitCode({ checked: 0, findings: [], skipped: [] })).toBe(0)
    expect(
      deletionsExitCode({
        checked: 1,
        findings: [{ orphanedHeadings: ['### X'], orphanedLinkTargets: [], path: '/r/docs/old.md' }],
        skipped: ['/r/docs/corrupt.md'],
      }),
    ).toBe(0)
  })
})
