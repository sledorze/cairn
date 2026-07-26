// Effect program: scan Markdown files for dead relative links and, when
// `fix` is set, auto-repair the unambiguous ones. Pure link logic lives in
// ../core/MarkdownLinks.ts; filesystem access goes through the DocsFs service.

import * as nodePath from 'node:path'

import { Effect } from 'effect'

import {
  describeAnchors,
  extractAnchors,
  isValidLineAnchor,
  normalizeAnchor,
  parseLineAnchor,
} from '../core/Anchors.ts'
import { matchesAny } from '../core/glob.ts'
import type { BrokenLink, PendingCheck } from '../core/MarkdownLinks.ts'
import { buildBasenameIndex, checkContent, stripCode, suggestFix } from '../core/MarkdownLinks.ts'
import { isWithinBase } from '../core/paths.ts'
import type { DocsFsService } from '../io/DocsFs.ts'
import { DocsFs } from '../io/DocsFs.ts'
import type { Locale } from './locale.ts'
import { pick } from './locale.ts'

// POSIX path semantics (inputs are normalised to `/` at the IO boundary).
const path = nodePath.posix

export interface FileBroken {
  readonly file: string
  readonly links: readonly BrokenLink[]
}

export interface LinkCheckResult {
  readonly broken: readonly FileBroken[]
  readonly checked: number
  readonly fixed: number
}

export interface CheckLinksArgs {
  /** The repository checkout root — the hard boundary a target outside
   * `roots` may still be verified within (issue #39's security requirement:
   * nothing outside `base` is ever stat'd, so cairn can't be turned into a
   * filesystem-existence oracle by an untrusted PR's link targets). */
  readonly base: string
  readonly fix: boolean
  readonly ignore?: readonly string[]
  readonly roots: readonly string[]
}

export interface LinkReportOptions {
  readonly locale?: Locale
}

const withAncestors = (files: readonly string[]): Set<string> => {
  const set = new Set<string>(files)
  for (const file of files) {
    let dir = path.dirname(file)
    while (!set.has(dir)) {
      set.add(dir)
      const parent = path.dirname(dir)
      if (parent === dir) {
        break
      }
      dir = parent
    }
  }
  return set
}

/** Occurrences of `token` in `text`. */
const countOccurrences = (text: string, token: string): number => (token === '' ? 0 : text.split(token).length - 1)

/**
 * Replace a broken link/definition target with its suggestion, but ONLY when the
 * target does not also appear inside a code span — replacing it there would
 * corrupt a code example. Returns the new content and whether a change was made.
 */
const applyFix = (content: string, target: string, suggestion: string): { changed: boolean; content: string } => {
  const masked = stripCode(content)
  let next = content
  let changed = false
  for (const [from, to] of [
    [`](${target})`, `](${suggestion})`],
    [`]: ${target}`, `]: ${suggestion}`],
  ] as const) {
    if (countOccurrences(content, from) === 0) {
      continue
    }
    // Every occurrence must be outside code (full count === masked count).
    if (countOccurrences(masked, from) !== countOccurrences(content, from)) {
      continue
    }
    next = next.split(from).join(to)
    changed = true
  }
  return { changed, content: next }
}

/** 0 when no broken links remain, 1 otherwise. */
export const linkExitCode = (result: LinkCheckResult): number => (result.broken.length > 0 ? 1 : 0)

/** Human-readable report lines (pure, so it can be unit-tested). */
export const formatLinkReport = (result: LinkCheckResult, options: LinkReportOptions = {}): string[] => {
  const locale = options.locale ?? 'en'
  const lines: string[] = []
  if (result.fixed > 0) {
    lines.push(
      pick(locale, { en: `🔧 Auto-repaired ${result.fixed} link(s).`, fr: `🔧 Auto-réparé ${result.fixed} lien(s).` }),
    )
  }
  if (result.broken.length === 0) {
    lines.push(
      pick(locale, {
        en: `✅ Markdown links OK (${result.checked} file(s) checked).`,
        fr: `✅ Liens Markdown OK (${result.checked} fichier(s) vérifié(s)).`,
      }),
    )
    return lines
  }
  const total = result.broken.reduce((n, f) => n + f.links.length, 0)
  lines.push(pick(locale, { en: `❌ ${total} dead link(s):`, fr: `❌ ${total} lien(s) mort(s) :` }))
  for (const { file, links } of result.broken) {
    lines.push(`  ${file}`)
    for (const link of links) {
      lines.push(`    ✗ [${link.text}](${link.target})${linkHint(locale, link)}`)
    }
  }
  return lines
}

/**
 * Why a link is broken, for a human — distinct from `(no unique target)`
 * (a *path* with no unambiguous fix) so an anchor/line failure never reads as
 * a missing-file problem: the target resolves fine, only its `#fragment` doesn't.
 */
const linkHint = (locale: Locale, link: BrokenLink): string => {
  if (link.suggestion !== undefined) {
    return pick(locale, { en: ` → suggestion: ${link.suggestion}`, fr: ` → suggestion : ${link.suggestion}` })
  }
  const detail = link.detail !== undefined ? ` — ${link.detail}` : ''
  if (link.reason === 'anchor') {
    return pick(locale, { en: ` (heading/anchor not found${detail})`, fr: ` (ancre introuvable${detail})` })
  }
  if (link.reason === 'line') {
    return pick(locale, { en: ` (line number out of range${detail})`, fr: ` (numéro de ligne hors limites${detail})` })
  }
  return pick(locale, { en: ' (no unique target)', fr: ' (aucune cible unique)' })
}

/**
 * Resolve one deferred `PendingCheck` with real IO, bounded by `base`
 * (issue #39's security requirement — a target outside `base` is never
 * stat'd, existence-oracle risk closed regardless of what's actually there).
 * `existsCache`/`contentCache`/`anchorCache` are shared across every pending
 * check in a run so a file referenced by many links is only ever stat'd/
 * read/slugged once. Content is fetched only when an anchor actually needs
 * validating — a plain out-of-root existence check (no `#fragment`) never
 * reads the target's full body just to confirm it's there.
 */
const resolvePendingCheck = ({
  base,
  existsCache,
  contentCache,
  anchorCache,
  dfs,
  index,
  item,
  known,
}: {
  readonly base: string
  readonly existsCache: Map<string, boolean>
  readonly contentCache: Map<string, string | null>
  readonly anchorCache: Map<string, ReadonlySet<string>>
  readonly dfs: DocsFsService
  readonly index: ReadonlyMap<string, readonly string[]>
  readonly item: PendingCheck
  readonly known: ReadonlySet<string>
}): Effect.Effect<BrokenLink | null> =>
  Effect.gen(function* () {
    let exists = existsCache.get(item.targetAbs)
    if (exists === undefined) {
      if (known.has(item.targetAbs)) {
        exists = true
      } else if (isWithinBase(item.targetAbs, base)) {
        exists = yield* dfs.exists(item.targetAbs)
      } else {
        // Outside the checkout root entirely: never touched, unconditionally
        // "cannot verify" — the observable signal stays constant regardless
        // of what's actually on disk there.
        exists = false
      }
      existsCache.set(item.targetAbs, exists)
    }

    if (!exists) {
      const suggestion = suggestFix({ fromDir: item.fromDir, index, target: item.target })
      return suggestion
        ? { reason: 'path', suggestion, target: item.target, text: item.text }
        : { reason: 'path', target: item.target, text: item.text }
    }

    if (item.anchor === null) {
      return null
    }

    let content = contentCache.get(item.targetAbs)
    if (content === undefined) {
      // `exists` only proves the path resolves to SOMETHING — a directory
      // (from `known`'s ancestor-dir entries, or from a real out-of-root
      // directory) also "exists" but isn't readable as text, and would
      // otherwise die here (Effect.orDie) and take the whole run down over
      // one malformed/unusual link. Existence already holds, so this is
      // genuinely unverifiable, not broken and not a crash.
      content = yield* dfs.readFile(item.targetAbs).pipe(Effect.catchDefect(() => Effect.succeed(null)))
      contentCache.set(item.targetAbs, content)
    }
    if (content === null) {
      return null
    }

    const normalized = normalizeAnchor(item.anchor)
    const lineRange = parseLineAnchor(normalized)
    if (lineRange) {
      const lineCount = content.split('\n').length
      if (isValidLineAnchor(lineRange, lineCount)) {
        return null
      }
      const detail = `target has ${lineCount} line${lineCount === 1 ? '' : 's'}`
      return { detail, reason: 'line', target: item.target, text: item.text }
    }

    if (!item.targetAbs.toLowerCase().endsWith('.md')) {
      // A non-line, non-md fragment is a symbol anchor (`x.ts#someExport`) —
      // explicitly out of v1 scope (issue #39, scenario G): unverifiable, so
      // never flagged broken rather than risk a false positive.
      return null
    }

    let anchors = anchorCache.get(item.targetAbs)
    if (!anchors) {
      anchors = extractAnchors(content)
      anchorCache.set(item.targetAbs, anchors)
    }
    return anchors.has(normalized)
      ? null
      : { detail: describeAnchors(anchors), reason: 'anchor', target: item.target, text: item.text }
  })

export const checkLinks = ({
  base,
  fix,
  ignore = [],
  roots,
}: CheckLinksArgs): Effect.Effect<LinkCheckResult, never, DocsFs> =>
  Effect.gen(function* () {
    const dfs = yield* DocsFs
    // The existence universe stays complete (so links to ignored files still
    // resolve); `ignore` only removes files from the set we scan as sources.
    const allFiles = yield* dfs.listFiles(roots)
    const index = buildBasenameIndex(allFiles)
    const known = withAncestors(allFiles)
    const existsAbs = (p: string): boolean => known.has(p)
    const inRoots = (p: string): boolean => roots.some((root) => p === root || p.startsWith(`${root}/`))
    const mdFiles = allFiles.filter((file) => file.endsWith('.md') && !matchesAny(file, ignore))

    interface FileScan {
      content: string
      readonly file: string
      readonly pending: readonly PendingCheck[]
      readonly resolvedExtra: BrokenLink[]
      readonly syncBroken: readonly BrokenLink[]
    }
    const scans: FileScan[] = []
    for (const file of mdFiles) {
      const content = yield* dfs.readFile(file)
      const { broken: syncBroken, pending } = checkContent({ content, existsAbs, fileAbs: file, inRoots, index })
      scans.push({ content, file, pending, resolvedExtra: [], syncBroken })
    }

    // Resolve every deferred anchor/cross-hierarchy check once, sharing
    // per-target caches across the whole run.
    const existsCache = new Map<string, boolean>()
    const contentCache = new Map<string, string | null>()
    const anchorCache = new Map<string, ReadonlySet<string>>()
    for (const scan of scans) {
      for (const item of scan.pending) {
        const result = yield* resolvePendingCheck({
          anchorCache,
          base,
          contentCache,
          dfs,
          existsCache,
          index,
          item,
          known,
        })
        if (result) {
          scan.resolvedExtra.push(result)
        }
      }
    }

    const broken: FileBroken[] = []
    let fixed = 0

    for (const scan of scans) {
      let content = scan.content
      const links = [...scan.syncBroken, ...scan.resolvedExtra]
      if (links.length === 0) {
        continue
      }

      const remaining: BrokenLink[] = []
      let changed = false
      for (const link of links) {
        const repair =
          fix && link.suggestion !== undefined ? applyFix(content, link.target, link.suggestion) : undefined
        if (repair?.changed) {
          content = repair.content
          changed = true
          fixed += 1
        } else {
          remaining.push(link)
        }
      }
      if (changed) {
        yield* dfs.writeFile(scan.file, content)
      }
      if (remaining.length > 0) {
        broken.push({ file: scan.file, links: remaining })
      }
    }

    return { broken, checked: mdFiles.length, fixed }
  })
