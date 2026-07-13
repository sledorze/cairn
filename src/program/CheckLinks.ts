// Effect program: scan Markdown files for dead relative links and, when
// `fix` is set, auto-repair the unambiguous ones. Pure link logic lives in
// ../core/MarkdownLinks.ts; filesystem access goes through the DocsFs service.

import * as nodePath from 'node:path'

import { Effect } from 'effect'

import { matchesAny } from '../core/glob.ts'
import type { BrokenLink } from '../core/MarkdownLinks.ts'
import { buildBasenameIndex, checkContent, stripCode } from '../core/MarkdownLinks.ts'
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
      const hint =
        link.suggestion !== undefined
          ? pick(locale, { en: ` → suggestion: ${link.suggestion}`, fr: ` → suggestion : ${link.suggestion}` })
          : pick(locale, { en: ' (no unique target)', fr: ' (aucune cible unique)' })
      lines.push(`    ✗ [${link.text}](${link.target})${hint}`)
    }
  }
  return lines
}

export const checkLinks = ({
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
    const mdFiles = allFiles.filter((file) => file.endsWith('.md') && !matchesAny(file, ignore))

    const broken: FileBroken[] = []
    let fixed = 0

    for (const file of mdFiles) {
      let content = yield* dfs.readFile(file)
      const links = checkContent({ content, existsAbs, fileAbs: file, index })
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
        yield* dfs.writeFile(file, content)
      }
      if (remaining.length > 0) {
        broken.push({ file, links: remaining })
      }
    }

    return { broken, checked: mdFiles.length, fixed }
  })
