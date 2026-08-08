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

import { extractDeclaredRefs } from '../../core/links/DeclaredRefs.ts'
import type { Reference } from '../../core/links/MarkdownLinks.ts'
import { extractReferences } from '../../core/links/MarkdownLinks.ts'
import type { RefRecord } from '../../core/links/RefStore.ts'
import { parseRefs, refsSidecarPathFor, serializeRefs } from '../../core/links/RefStore.ts'
import { hashContent } from '../../core/hashing.ts'
import { matchesGlobNearBase } from '../../core/paths.ts'
import type { RefsScopeGroup } from '../../core/Config.ts'
import { metaRootFor } from '../../core/sidecar.ts'
import { DocsFs, isSafelyWithinBase, listMarkdownFiles, readMarkdownCorpus } from '../../io/DocsFs.ts'
import type { CheckPlugin } from '../checks/CheckPlugin.ts'
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
  /** ADR 0004 Release 1 (`refs.scope`): first-match-wins glob groups deciding
   * a target's hashing granularity. `[]` (the default) preserves today's
   * only behavior — every target hashed `whole-file`. */
  readonly scope?: readonly RefsScopeGroup[]
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
 * First matching `scope` group (array order) decides `targetAbs`'s hashing
 * granularity; no match keeps today's only behavior, `whole-file` — see
 * `RefsScopeGroupInputSchema`'s own comment (`core/Config.ts`) for the
 * first-match-wins semantics. Matched via `matchesGlobNearBase`, the same
 * helper `CheckDocCoverage.ts`'s own glob groups already use, so a glob
 * written root-relative (the form anyone writes) matches as expected.
 */
const unitFor = (targetAbs: string, base: string, scope: readonly RefsScopeGroup[]): 'whole-file' | 'ignore' =>
  scope.find((group) => matchesGlobNearBase(targetAbs, base, [group.glob]))?.unit ?? 'whole-file'

/**
 * Resolve one reference target to its real, CURRENT content — bounded by
 * `base` exactly like `CheckLinks.ts`'s `resolvePendingCheck` (nothing
 * outside the checkout root is ever stat'd/read). `null` if the target
 * doesn't currently exist or isn't readable (e.g. a directory): a target
 * that no longer resolves is `CheckLinks.ts`'s "broken" concern, not this
 * file's "stale" concern, so it's silently skipped here rather than
 * double-reported.
 *
 * `unit === 'ignore'` (ADR 0004 Release 1) short-circuits to `null` BEFORE
 * `isSafelyWithinBase` even runs — an ignored glob is never read at all, not
 * read-then-discarded, matching this repo's own "don't touch the filesystem
 * for something structurally excluded" discipline (e.g. `DocsFs.ts`'s
 * `isPrunedDir` pruning before `readDirectory`, not after).
 */
const resolveReferenceContent = ({
  base,
  dfs,
  targetAbs,
  unit,
}: {
  readonly base: string
  readonly dfs: {
    readFile: (p: string) => Effect.Effect<string>
    realPath: (p: string) => Effect.Effect<string | null>
  }
  readonly targetAbs: string
  readonly unit: 'whole-file' | 'ignore'
}): Effect.Effect<string | null> =>
  Effect.gen(function* () {
    if (unit === 'ignore') {
      return null
    }
    // `isSafelyWithinBase` (../../io/DocsFs.ts): a symlink physically
    // located INSIDE `base` can still point OUTSIDE it. Without this, a
    // symlink escaping `base` had its CONTENT hashed and the hash
    // committed into a `.cairn/refs/**` sidecar — a persisted content-
    // fingerprint oracle for arbitrary files, worse than the existence-
    // only oracle issue #39 was written to close (adversarial review,
    // issue #28's PR).
    const safe = yield* isSafelyWithinBase(dfs, targetAbs, base)
    if (!safe) {
      return null
    }
    return yield* dfs.readFile(targetAbs).pipe(Effect.catchDefect(() => Effect.succeed(null)))
  })

const toRecord = (ref: { readonly anchor: string | null; readonly target: string }, hash: string): RefRecord =>
  ref.anchor === null ? { hash, target: ref.target } : { anchor: ref.anchor, hash, target: ref.target }

/**
 * A real link's targets (`extractReferences`) plus a doc's DECLARED extra
 * targets (`extractDeclaredRefs`, issue #130 — a claim with no natural link
 * syntax) — unioned, deduped by `(target, anchor)`. Real links win ties: a
 * target already reached via a real link is never re-added from a
 * declaration, so nothing about how a target reached this list is visible
 * downstream (same `RefRecord` shape either way). `checkRefs` needs no
 * matching change — it only ever replays what `stampRefs` already wrote.
 */
const allReferenceTargets = (content: string): Reference[] => {
  const refs = extractReferences(content)
  const seen = new Set(refs.map((r) => `${r.target}#${r.anchor ?? ''}`))
  for (const ref of extractDeclaredRefs(content)) {
    const key = `${ref.target}#${ref.anchor ?? ''}`
    if (!seen.has(key)) {
      seen.add(key)
      refs.push(ref)
    }
  }
  return refs
}

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
  scope = [],
  trackedFiles,
}: CheckRefsArgs): Effect.Effect<StampRefsResult, never, DocsFs> =>
  Effect.gen(function* () {
    const dfs = yield* DocsFs
    const layout = { base, metaRoot: metaRootFor(base) }
    // `readMarkdownCorpus` already gives an unreadable doc (permission
    // denied) the same lenient skip this used to hand-roll — see its own
    // doc comment for the discipline this matches.
    const mdFiles = yield* readMarkdownCorpus(dfs, roots, ignore, trackedFiles)
    let stamped = 0
    for (const [file, content] of mdFiles) {
      const fromDir = path.dirname(file)
      const records: RefRecord[] = []
      for (const ref of allReferenceTargets(content)) {
        const targetAbs = path.resolve(fromDir, ref.target)
        const unit = unitFor(targetAbs, base, scope)
        const targetContent = yield* resolveReferenceContent({ base, dfs, targetAbs, unit })
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
  scope = [],
  trackedFiles,
}: CheckRefsArgs): Effect.Effect<RefsCheckResult, never, DocsFs> =>
  Effect.gen(function* () {
    const dfs = yield* DocsFs
    const layout = { base, metaRoot: metaRootFor(base) }
    const mdFiles = yield* listMarkdownFiles(dfs, roots, ignore, trackedFiles)
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
        const unit = unitFor(targetAbs, base, scope)
        const targetContent = yield* resolveReferenceContent({ base, dfs, targetAbs, unit })
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

// The CheckPlugin descriptor cli.ts's registry runner drives — see
// ../checks/CheckPlugin.ts's own header for why this abstraction exists.
// `isEnabled` matches cli.ts's exact prior gate: `parsed.refs` (refs has no
// config field of its own, CLI-flag opt-in only). `jsonUnsupportedMessage`
// matches cli.ts's prior `--json cannot be combined with --refs yet` guard
// word-for-word — a behavior-preserving refactor, not a new message.
export const refsPlugin: CheckPlugin<RefsCheckResult> = {
  exitCode: refsExitCode,
  format: (result, options) => formatRefsReport(result, options),
  isEnabled: (_resolved, cli) => cli.refs,
  jsonUnsupportedMessage: '--json cannot be combined with --refs yet',
  name: 'refs',
  run: ({ base, ignore, resolved, roots, trackedFiles }) =>
    checkRefs({
      base,
      ignore,
      roots,
      scope: resolved.refs.scope,
      ...(trackedFiles === undefined ? {} : { trackedFiles }),
    }),
  stamp: ({ base, ignore, resolved, roots, trackedFiles }) =>
    Effect.gen(function* () {
      const result = yield* stampRefs({
        base,
        ignore,
        roots,
        scope: resolved.refs.scope,
        ...(trackedFiles === undefined ? {} : { trackedFiles }),
      })
      return [
        pick(resolved.locale, {
          en: `🔗 Stamped ${result.stamped} doc(s)' reference hash(es) (.cairn/** sidecar).`,
          fr: `🔗 ${result.stamped} document(s) tamponné(s) (hachage des références, fichier annexe .cairn/**).`,
        }),
      ]
    }),
}
