// Effect program: scan Markdown files for dead relative links and, when
// `fix` is set, auto-repair the unambiguous ones. Pure link logic lives in
// ../../core/links/MarkdownLinks.ts; filesystem access goes through the DocsFs service.

import * as nodePath from 'node:path'

import { Effect } from 'effect'

import {
  describeAnchors,
  extractAnchors,
  isValidLineAnchor,
  normalizeAnchor,
  parseLineAnchor,
  suggestAnchorFix,
} from '../../core/links/Anchors.ts'
import type { BrokenLink, PendingCheck } from '../../core/links/MarkdownLinks.ts'
import { buildBasenameIndex, checkContent, stripAnchor, stripCode, suggestFix } from '../../core/links/MarkdownLinks.ts'
import { matchesAny } from '../../core/glob.ts'
import { isWithinBase } from '../../core/paths.ts'
import type { DocsFsService } from '../../io/DocsFs.ts'
import { DocsFs } from '../../io/DocsFs.ts'
import type { CheckPlugin } from '../checks/CheckPlugin.ts'
import type { Locale } from '../locale.ts'
import { pick } from '../locale.ts'

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
  /** A file `listFiles` found but that couldn't actually be READ (permission
   * denied, revoked between listing and reading, etc.) — found via
   * adversarial "no unhandled exception" review: `dfs.readFile` on the
   * primary scan is `Effect.orDie`-wrapped, so this used to crash the whole
   * run with a raw internal stack trace instead of a clean, actionable
   * report. Skipped from checking (nothing meaningful can be verified about
   * content that can't be read) but never silent — always non-empty here
   * when it happens, and always makes `linkExitCode` non-zero, so a real,
   * user-triggerable problem (e.g. a permission bit accidentally committed
   * wrong) fails CI loudly and clearly instead of passing unnoticed. */
  readonly unreadable: readonly string[]
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
  /** Issue #48 (`onlyGitTracked`): when supplied, both the scanned-source universe
   * AND the existence universe (`known`, plus every out-of-`roots` target checked
   * by `resolvePendingCheck`) are restricted to this set — absolute POSIX paths, as
   * `GitFs.listTrackedFiles` returns them. This deliberately extends past source
   * scanning to link-TARGET existence too (not just which docs get scanned): a
   * link to an untracked file is exactly as invisible to a fresh CI checkout as an
   * untracked doc missing its own summary, so the same CI-parity guarantee has to
   * cover both directions, not just the doc side the issue's own example shows.
   * `undefined` (the default) preserves today's behavior byte-for-byte. */
  readonly trackedFiles?: ReadonlySet<string> | undefined
}

export interface LinkReportOptions {
  readonly locale?: Locale
}

/** Exported for `CheckProseRefs.ts`'s own `trackedUniverse` — same shape,
 * same reasoning (a tracked file's ancestor directories must also read as
 * "known" so a physically-present target isn't rejected purely because a
 * containing directory itself isn't a git blob). */
export const withAncestors = (files: readonly string[]): Set<string> => {
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

export interface FileFixResult {
  /** True whenever `applyFix` reported a real change for at least one target
   * — the single source of truth for "does this file need to be written,"
   * deliberately NOT derived by comparing `content` to the original string.
   * Found via adversarial review of the original extraction: `applyFix`'s
   * `changed: true` does not guarantee the text actually differs (a
   * target === suggestion replace is a textual no-op that still reports
   * `changed: true`) — currently unreachable in practice (`suggestFix`/
   * `suggestAnchorFix` can only ever produce a suggestion that differs from
   * the broken target, by construction), but nothing pins that invariant in
   * the type system, so a string-equality write-trigger would have been a
   * latent landmine for a future caller that broke it. */
  readonly changed: boolean
  readonly content: string
  readonly fixed: number
  readonly remaining: readonly BrokenLink[]
}

/**
 * Apply every unambiguous fix among `links` to `content`, once per unique
 * `target` string — a pure fold, no mutable closure state. Given an honest
 * standalone signature (rather than living as a closure inside `checkLinks`'s
 * `Effect.gen` block) so this is independently unit-testable and its
 * behavior doesn't depend on capturing outer variables.
 *
 * Fixing is keyed by `target`, not by individual `BrokenLink` record: issue
 * #49's dimension-coverage review found that a broken target repeated more
 * than once in the same file (e.g. the same dead link mentioned twice in
 * prose and again in a "See also" list) produced a real misreport when
 * `applyFix` was called again per record — its occurrence-safe replace is
 * GLOBAL (fixes every occurrence of `target` in one call, by design;
 * occurrence-safety only works all-or-nothing), so the second call against
 * already-repaired content found nothing left to replace and fell through
 * to "unfixed," even though the file was already fully, correctly repaired
 * by the first call. Folding a `target -> outcome` map alongside `content`
 * (same target ⇒ same suggestion, since both are deterministic functions of
 * `target` + the resolved data) makes every record sharing that target
 * agree with what actually happened on disk, in one pass.
 */
export const applyFixesToFile = (content: string, links: readonly BrokenLink[], fix: boolean): FileFixResult => {
  const fixedTargets = new Map<string, boolean>()
  const remaining: BrokenLink[] = []
  let current = content
  let fixed = 0
  let changed = false
  for (const link of links) {
    if (!fix || link.suggestion === undefined) {
      remaining.push(link)
      continue
    }
    let succeeded = fixedTargets.get(link.target)
    if (succeeded === undefined) {
      const repair = applyFix(current, link.target, link.suggestion)
      current = repair.changed ? repair.content : current
      changed ||= repair.changed
      succeeded = repair.changed
      fixedTargets.set(link.target, succeeded)
    }
    if (succeeded) {
      fixed += 1
    } else {
      remaining.push(link)
    }
  }
  return { changed, content: current, fixed, remaining }
}

/** 0 when no broken links remain, 1 otherwise. */
export const linkExitCode = (result: LinkCheckResult): number =>
  result.broken.length > 0 || result.unreadable.length > 0 ? 1 : 0

/** Human-readable report lines (pure, so it can be unit-tested). */
export const formatLinkReport = (result: LinkCheckResult, options: LinkReportOptions = {}): string[] => {
  const locale = options.locale ?? 'en'
  const lines: string[] = []
  if (result.fixed > 0) {
    lines.push(
      pick(locale, { en: `🔧 Auto-repaired ${result.fixed} link(s).`, fr: `🔧 Auto-réparé ${result.fixed} lien(s).` }),
    )
  }
  if (result.unreadable.length > 0) {
    lines.push(
      pick(locale, {
        en: `⚠️  ${result.unreadable.length} file(s) could not be read (permission denied?):`,
        fr: `⚠️  ${result.unreadable.length} fichier(s) illisible(s) (permission refusée ?) :`,
      }),
    )
    for (const file of result.unreadable) {
      lines.push(`  ✗ ${file}`)
    }
  }
  if (result.broken.length === 0) {
    if (result.unreadable.length === 0) {
      lines.push(
        pick(locale, {
          en: `✅ Markdown links OK (${result.checked} file(s) checked).`,
          fr: `✅ Liens Markdown OK (${result.checked} fichier(s) vérifié(s)).`,
        }),
      )
    }
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
  trackedUniverse,
}: {
  readonly base: string
  readonly existsCache: Map<string, boolean>
  readonly contentCache: Map<string, string | null>
  readonly anchorCache: Map<string, ReadonlySet<string>>
  readonly dfs: DocsFsService
  readonly index: ReadonlyMap<string, readonly string[]>
  readonly item: PendingCheck
  readonly known: ReadonlySet<string>
  /** Issue #48: when set, a physically-present out-of-`roots` target counts as
   * "existing" only if it's ALSO in the git-tracked universe (files + their
   * ancestor directories, same shape as `known`) — otherwise an untracked file
   * outside `roots` would report as resolved locally while a fresh CI checkout,
   * which never sees untracked content, would report it broken. `undefined`
   * preserves today's plain-existence check unchanged. */
  readonly trackedUniverse: ReadonlySet<string> | undefined
}): Effect.Effect<BrokenLink | null> =>
  Effect.gen(function* () {
    let exists = existsCache.get(item.targetAbs)
    if (exists === undefined) {
      if (known.has(item.targetAbs)) {
        exists = true
      } else if (isWithinBase(item.targetAbs, base)) {
        const physical = yield* dfs.exists(item.targetAbs)
        exists = physical && (trackedUniverse === undefined || trackedUniverse.has(item.targetAbs))
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
    if (anchors.has(normalized)) {
      return null
    }
    // Issue #49: same exact-case-insensitive-match repair as the same-page
    // case (MarkdownLinks.ts's checkContent) — the suggestion is the FULL
    // corrected target (path unchanged, `#fragment` replaced), reusing
    // `applyFix`'s existing whole-target, occurrence-safe replacement.
    const fixedAnchor = suggestAnchorFix(normalized, anchors)
    return {
      detail: describeAnchors(anchors),
      reason: 'anchor',
      ...(fixedAnchor === null ? {} : { suggestion: `${stripAnchor(item.target)}#${fixedAnchor}` }),
      target: item.target,
      text: item.text,
    }
  })

export const checkLinks = ({
  base,
  fix,
  ignore = [],
  roots,
  trackedFiles,
}: CheckLinksArgs): Effect.Effect<LinkCheckResult, never, DocsFs> =>
  Effect.gen(function* () {
    const dfs = yield* DocsFs
    // `ignore` still only removes FILE-shaped matches from the set we scan
    // as sources — a link pointing AT an individually-ignored file still
    // resolves. Issue #63 changed one thing: `ignore` is now also passed to
    // `listFiles` itself, so a DIRECTORY-shaped match (the default
    // `"**/node_modules/**"` included) is pruned during the walk rather
    // than fully materialized and filtered afterward — the actual OOM fix.
    // Named side effect, not silently absorbed: a link pointing INTO a
    // pruned directory (e.g. `../node_modules/x/README.md`) now reports
    // broken instead of resolving, whereas before, only the source-scan set
    // excluded it. Considered acceptable — a doc legitimately linking into
    // an ignored directory is a vanishingly rare case next to "the tool
    // doesn't OOM-crash on an ordinary repo."
    // Issue #48: `trackedFiles`, when provided, narrows BOTH the existence
    // universe and the source-scan set — an untracked file is invisible to a
    // fresh CI checkout on both sides of a link.
    const listedFiles = yield* dfs.listFiles(roots, ignore)
    const allFiles = trackedFiles === undefined ? listedFiles : listedFiles.filter((file) => trackedFiles.has(file))
    const index = buildBasenameIndex(allFiles)
    const known = withAncestors(allFiles)
    const trackedUniverse = trackedFiles === undefined ? undefined : withAncestors([...trackedFiles])
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
    const unreadable: string[] = []
    for (const file of mdFiles) {
      // A file `listFiles` found but that can't actually be READ (permission
      // denied, revoked between listing and reading) must not crash the
      // whole run — found via adversarial "no unhandled exception" review,
      // reproduced for real against a `chmod 000` doc. `dfs.readFile` is
      // `Effect.orDie`-wrapped, so this reaches the DEFECT channel, not a
      // typed failure — `Effect.catchDefect` is the right combinator here
      // (contrast `DocsFs.ts`'s `listFiles` fix, which needed `Effect.catch`
      // because THAT failure is still a typed `PlatformError` at that point).
      const content = yield* dfs.readFile(file).pipe(Effect.catchDefect(() => Effect.succeed(null)))
      if (content === null) {
        unreadable.push(file)
        continue
      }
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
          trackedUniverse,
        })
        if (result) {
          scan.resolvedExtra.push(result)
        }
      }
    }

    const broken: FileBroken[] = []
    let fixed = 0

    for (const scan of scans) {
      const links = [...scan.syncBroken, ...scan.resolvedExtra]
      if (links.length === 0) {
        continue
      }
      const result = applyFixesToFile(scan.content, links, fix)
      fixed += result.fixed
      if (result.changed) {
        yield* dfs.writeFile(scan.file, result.content)
      }
      if (result.remaining.length > 0) {
        broken.push({ file: scan.file, links: result.remaining })
      }
    }

    return { broken, checked: mdFiles.length - unreadable.length, fixed, unreadable }
  })

// The CheckPlugin descriptor cli.ts's registry runner drives — see
// ../checks/CheckPlugin.ts's own header for why this abstraction exists.
// `isEnabled` matches cli.ts's exact prior gate: `config.checks.links &&
// !parsed.summariesOnly`. No `jsonUnsupportedMessage`: links is the one
// migrated check that DOES participate in `--json` output (via
// buildJsonReport), so it must never be rejected outright.
export const linksPlugin: CheckPlugin<LinkCheckResult> = {
  exitCode: linkExitCode,
  format: (result, options) => formatLinkReport(result, options),
  isEnabled: (resolved, cli) => resolved.checks.links && !cli.summariesOnly,
  name: 'links',
  run: ({ base, cli, ignore, roots, trackedFiles }) =>
    checkLinks({ base, fix: cli.fix, ignore, roots, ...(trackedFiles === undefined ? {} : { trackedFiles }) }),
}
