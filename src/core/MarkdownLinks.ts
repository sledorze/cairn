// Pure, IO-free helpers to find and auto-repair relative Markdown links.
// All functions here are deterministic and unit-tested in MarkdownLinks.unit.test.ts.
// The Effect program that touches the filesystem lives in ../program/CheckLinks.ts.

import * as nodePath from 'node:path'

// Reason in POSIX so link resolution is identical on every OS (inputs are
// normalised to `/` at the IO boundary).
const path = nodePath.posix

export interface MarkdownLink {
  readonly target: string
  readonly text: string
}

export interface MarkdownLinkDef {
  readonly label: string
  readonly target: string
}

export interface BrokenLink {
  readonly suggestion?: string
  readonly target: string
  readonly text: string
}

export interface SuggestFixArgs {
  readonly fromDir: string
  readonly index: ReadonlyMap<string, readonly string[]>
  readonly target: string
}

export interface CheckContentArgs {
  readonly content: string
  readonly existsAbs: (absPath: string) => boolean
  readonly fileAbs: string
  readonly index?: ReadonlyMap<string, readonly string[]>
}

const LINK_RE = /!?\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
const FENCED_CODE_RE = /(^|\n)[ \t]*(```|~~~)[\s\S]*?\n[ \t]*\2[ \t]*(?=\n|$)/g
const INLINE_CODE_RE = /`[^`\n]*`/g

/**
 * Blank out fenced (``` / ~~~) and inline (`code`) spans so links that only
 * appear inside code examples are NOT treated as real links. Newlines are kept
 * so line-based reasoning is unaffected; other characters become spaces.
 */
export const stripCode = (content: string): string =>
  content
    .replaceAll(FENCED_CODE_RE, (block) => block.replaceAll(/[^\n]/g, ' '))
    .replaceAll(INLINE_CODE_RE, (block) => ' '.repeat(block.length))

const LINK_DEF_RE = /^[ \t]*\[([^\]]+)\]:[ \t]*<?([^>\s]+)>?/gm

/** Extract inline Markdown links/images as `{ target, text }`. */
export const extractLinks = (content: string): MarkdownLink[] => {
  const links: MarkdownLink[] = []
  for (const match of content.matchAll(LINK_RE)) {
    links.push({ target: match[2] ?? '', text: match[1] ?? '' })
  }
  return links
}

/** Extract reference-style link definitions (`[label]: ./path "title"`). */
export const extractLinkDefinitions = (content: string): MarkdownLinkDef[] => {
  const defs: MarkdownLinkDef[] = []
  for (const match of content.matchAll(LINK_DEF_RE)) {
    defs.push({ label: match[1] ?? '', target: match[2] ?? '' })
  }
  return defs
}

/** True only for relative paths we can resolve on disk. */
export const isCheckableTarget = (target: string): boolean => {
  if (!target) {
    return false
  }
  if (target.startsWith('#')) {
    return false
  } // same-page anchor
  if (target.startsWith('//')) {
    return false
  } // protocol-relative URL
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) {
    return false
  } // http:, mailto:, etc.
  return true
}

/** Drop `#anchor` and `?query` from a target. */
export const stripAnchor = (target: string): string => target.replace(/[#?].*$/, '')

/** Map basename -> list of absolute paths, for ambiguity-aware fixing. */
export const buildBasenameIndex = (absPaths: readonly string[]): Map<string, string[]> => {
  const index = new Map<string, string[]>()
  for (const abs of absPaths) {
    const base = path.basename(abs)
    const bucket = index.get(base)
    if (bucket) {
      bucket.push(abs)
    } else {
      index.set(base, [abs])
    }
  }
  return index
}

const toRelative = (fromDir: string, toAbs: string): string => {
  const rel = path.relative(fromDir, toAbs).split(path.sep).join('/')
  return rel.startsWith('.') ? rel : `./${rel}`
}

/**
 * Suggest a repaired relative path for a broken target. Returns a path only
 * when exactly one indexed file matches the basename (no ambiguity); else null.
 */
export const suggestFix = ({ fromDir, index, target }: SuggestFixArgs): string | null => {
  const base = path.basename(stripAnchor(target))
  const candidates = index.get(base)
  if (!candidates || candidates.length !== 1) {
    return null
  }
  return toRelative(fromDir, candidates[0] ?? '')
}

/**
 * Check one file's content for broken relative links. Returns the broken ones,
 * each with an optional `suggestion` when an `index` is supplied.
 */
export const checkContent = ({ content, existsAbs, fileAbs, index }: CheckContentArgs): BrokenLink[] => {
  const fromDir = path.dirname(fileAbs)
  const broken: BrokenLink[] = []
  const masked = stripCode(content)
  const candidates: MarkdownLink[] = [
    ...extractLinks(masked),
    // Reference-style definitions are checked by their target too.
    ...extractLinkDefinitions(masked).map((def) => ({ target: def.target, text: `[${def.label}]` })),
  ]
  for (const link of candidates) {
    if (!isCheckableTarget(link.target)) {
      continue
    }
    const rel = stripAnchor(link.target)
    if (!rel) {
      continue
    }
    const abs = path.resolve(fromDir, rel)
    if (existsAbs(abs)) {
      continue
    }
    const suggestion = index ? suggestFix({ fromDir, index, target: link.target }) : null
    broken.push(
      suggestion ? { suggestion, target: link.target, text: link.text } : { target: link.target, text: link.text },
    )
  }
  return broken
}
