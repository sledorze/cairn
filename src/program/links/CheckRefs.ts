// Effect programs for issue #39 Scenario I: record and check reference
// content hashes. `stampRefs` records the CURRENT hash of every resolvable
// reference target a doc makes; `checkRefs` compares the CURRENT hash
// against what was last recorded, surfacing drift as "may be stale" — a
// distinct signal from `CheckLinks.ts`'s "broken": the link still resolves,
// its target just isn't what it was when the reference was authored.
//
// Deliberately does NOT touch `CheckSummaries.ts`'s stamping machinery — the
// summary-tree Merkle/manifest hash computation answers a different
// question ("does this SUMMARY still reflect its SOURCE") with its own
// careful bottom-up invariants this file has no reason to entangle with.
// `stampRefs`/`checkRefs` are opt-in (wired behind `cairn check --refs`, not
// part of the default `checks.links`/`checks.summaries` gate) — v1 of a
// scenario the issue itself parks as "ships only after A-H are solid."

import * as nodePath from 'node:path'

import { Effect } from 'effect'

import { extractReferences } from '../../core/links/MarkdownLinks.ts'
import type { RefRecord } from '../../core/links/RefStore.ts'
import { parseRefs, refsSidecarPathFor, serializeRefs } from '../../core/links/RefStore.ts'
import { matchesAny } from '../../core/glob.ts'
import { hashContent } from '../../core/hashing.ts'
import { isWithinBase } from '../../core/paths.ts'
import { metaRootFor } from '../../core/sidecar.ts'
import { DocsFs } from '../../io/DocsFs.ts'
import type { Locale } from '../locale.ts'
import { pick } from '../locale.ts'

const path = nodePath.posix

export interface CheckRefsArgs {
  readonly base: string
  readonly roots: readonly string[]
  /** Found missing via a second, independent adversarial audit of this same
   * dimension-coverage pass: `trackedFiles` alone was wired first, but
   * `ignore` was not — a doc matching an `ignore` glob still had its
   * reference hashes stamped to a real on-disk sidecar and still got
   * reported as having stale references, exactly the "silently
   * inconsistent with every sibling check" gap this pass exists to close. */
  readonly ignore?: readonly string[]
  /** Found missing via dimension-coverage review of issue #48: with
   * `onlyGitTracked` on, an entirely untracked doc's ref-drift was still
   * scanned and its hashes stamped to a real `.cairn/refs/**` sidecar,
   * defeating the CI-parity guarantee `onlyGitTracked` makes everywhere
   * else. `undefined` (the default) preserves today's behavior unchanged. */
  readonly trackedFiles?: ReadonlySet<string> | undefined
}

export interface StaleRef {
  readonly anchor?: string
  readonly currentHash: string
  readonly recordedHash: string
  readonly target: string
}

export interface FileStaleRefs {
  readonly file: string
  readonly refs: readonly StaleRef[]
}

export interface RefsCheckResult {
  readonly checked: number
  readonly stale: readonly FileStaleRefs[]
}

export interface StampRefsResult {
  readonly stamped: number
}

/** 0 when nothing is stale, 1 otherwise — same convention as `linkExitCode`. */
export const refsExitCode = (result: RefsCheckResult): number => (result.stale.length > 0 ? 1 : 0)

/**
 * Resolve one reference target to its real, CURRENT content — bounded by
 * `base` exactly like `CheckLinks.ts`'s `resolvePendingCheck` (nothing
 * outside the checkout root is ever stat'd/read). `null` if the target
 * doesn't currently exist or isn't readable (e.g. a directory): a target
 * that no longer resolves is `CheckLinks.ts`'s "broken" concern, not this
 * file's "stale" concern, so it's silently skipped here rather than
 * double-reported.
 */
const resolveReferenceContent = ({
  base,
  dfs,
  targetAbs,
}: {
  readonly base: string
  readonly dfs: { exists: (p: string) => Effect.Effect<boolean>; readFile: (p: string) => Effect.Effect<string> }
  readonly targetAbs: string
}): Effect.Effect<string | null> =>
  Effect.gen(function* () {
    if (!isWithinBase(targetAbs, base)) {
      return null
    }
    const exists = yield* dfs.exists(targetAbs)
    if (!exists) {
      return null
    }
    return yield* dfs.readFile(targetAbs).pipe(Effect.catchDefect(() => Effect.succeed(null)))
  })

const listMdFiles = (
  roots: readonly string[],
  ignore: readonly string[],
  trackedFiles?: ReadonlySet<string>,
): Effect.Effect<readonly string[], never, DocsFs> =>
  Effect.gen(function* () {
    const dfs = yield* DocsFs
    const allFiles = yield* dfs.listFiles(roots, ignore)
    return allFiles.filter(
      (f) => f.endsWith('.md') && !matchesAny(f, ignore) && (trackedFiles === undefined || trackedFiles.has(f)),
    )
  })

const toRecord = (ref: { readonly anchor: string | null; readonly target: string }, hash: string): RefRecord =>
  ref.anchor === null ? { hash, target: ref.target } : { anchor: ref.anchor, hash, target: ref.target }

/**
 * Record the current content hash of every real reference each scanned doc
 * makes. Overwrites any previously-recorded sidecar unconditionally (same
 * "stamp always writes fresh state" convention as `stampSummaries`) — a doc
 * with no resolvable references gets no sidecar at all (nothing to compare
 * against later, and no reason to create an empty one).
 */
export const stampRefs = ({
  base,
  roots,
  ignore = [],
  trackedFiles,
}: CheckRefsArgs): Effect.Effect<StampRefsResult, never, DocsFs> =>
  Effect.gen(function* () {
    const dfs = yield* DocsFs
    const layout = { base, metaRoot: metaRootFor(base) }
    const mdFiles = yield* listMdFiles(roots, ignore, trackedFiles)
    let stamped = 0
    for (const file of mdFiles) {
      // Found via adversarial "no unhandled exception" review: a doc that
      // lists fine but can't be READ (permission denied) must not crash the
      // whole run — skipped exactly like an untracked/ignored file already
      // is, same discipline as `CheckSummaries.ts`'s own `readMarkdown` fix.
      const content = yield* dfs.readFile(file).pipe(Effect.catchDefect(() => Effect.succeed(null)))
      if (content === null) {
        continue
      }
      const fromDir = path.dirname(file)
      const records: RefRecord[] = []
      for (const ref of extractReferences(content)) {
        const targetAbs = path.resolve(fromDir, ref.target)
        const targetContent = yield* resolveReferenceContent({ base, dfs, targetAbs })
        if (targetContent !== null) {
          records.push(toRecord(ref, hashContent(targetContent)))
        }
      }
      if (records.length > 0) {
        yield* dfs.writeFile(refsSidecarPathFor(file, layout), serializeRefs({ refs: records }))
        stamped += 1
      }
    }
    return { stamped }
  })

/**
 * Compare each scanned doc's recorded reference hashes (if any) against
 * current target content, reporting drift. A doc with no refs sidecar
 * (never stamped, or every reference already broken/unrecordable) is
 * silently skipped — nothing recorded, nothing to compare.
 */
export const checkRefs = ({
  base,
  roots,
  ignore = [],
  trackedFiles,
}: CheckRefsArgs): Effect.Effect<RefsCheckResult, never, DocsFs> =>
  Effect.gen(function* () {
    const dfs = yield* DocsFs
    const layout = { base, metaRoot: metaRootFor(base) }
    const mdFiles = yield* listMdFiles(roots, ignore, trackedFiles)
    const stale: FileStaleRefs[] = []
    let checked = 0
    for (const file of mdFiles) {
      const sidecarPath = refsSidecarPathFor(file, layout)
      const sidecarExists = yield* dfs.exists(sidecarPath)
      if (!sidecarExists) {
        continue
      }
      // Same discipline as the primary-doc read above: an unreadable
      // sidecar (permission denied) is treated as "nothing recorded," not a
      // crash — consistent with `parseStamp`/`parseRefs`'s own existing
      // contract that a corrupt/unparseable sidecar is silently skipped.
      const sidecarContent = yield* dfs.readFile(sidecarPath).pipe(Effect.catchDefect(() => Effect.succeed(null)))
      const recorded = sidecarContent === null ? null : parseRefs(sidecarContent)
      if (recorded === null) {
        continue
      }
      checked += 1
      const fromDir = path.dirname(file)
      const drifted: StaleRef[] = []
      for (const record of recorded.refs) {
        const targetAbs = path.resolve(fromDir, record.target)
        const targetContent = yield* resolveReferenceContent({ base, dfs, targetAbs })
        if (targetContent === null) {
          continue
        }
        const currentHash = hashContent(targetContent)
        if (currentHash !== record.hash) {
          drifted.push(
            record.anchor === undefined
              ? { currentHash, recordedHash: record.hash, target: record.target }
              : { anchor: record.anchor, currentHash, recordedHash: record.hash, target: record.target },
          )
        }
      }
      if (drifted.length > 0) {
        stale.push({ file, refs: drifted })
      }
    }
    return { checked, stale }
  })

export interface RefsReportOptions {
  readonly locale?: Locale
}

/** Human-readable report lines (pure, so it can be unit-tested). */
export const formatRefsReport = (result: RefsCheckResult, options: RefsReportOptions = {}): string[] => {
  const locale = options.locale ?? 'en'
  const lines: string[] = []
  if (result.stale.length === 0) {
    lines.push(
      pick(locale, {
        en: `✅ References OK (${result.checked} tracked doc(s)).`,
        fr: `✅ Références OK (${result.checked} document(s) suivi(s)).`,
      }),
    )
    return lines
  }
  const total = result.stale.reduce((n, f) => n + f.refs.length, 0)
  lines.push(
    pick(locale, {
      en: `⚠️  ${total} possibly stale reference(s):`,
      fr: `⚠️  ${total} référence(s) possiblement obsolète(s) :`,
    }),
  )
  for (const { file, refs } of result.stale) {
    lines.push(`  ${file}`)
    for (const ref of refs) {
      const anchorSuffix = ref.anchor !== undefined ? `#${ref.anchor}` : ''
      lines.push(
        `    ~ ${ref.target}${anchorSuffix} (${ref.recordedHash.slice(0, 8)} → ${ref.currentHash.slice(0, 8)})`,
      )
    }
  }
  return lines
}
