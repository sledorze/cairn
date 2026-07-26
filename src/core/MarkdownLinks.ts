// Pure, IO-free helpers to find and auto-repair relative Markdown links.
// All functions here are deterministic and unit-tested in MarkdownLinks.unit.test.ts.
// The Effect program that touches the filesystem lives in ../program/CheckLinks.ts.

import * as nodePath from 'node:path'

import { extractAnchors } from './Anchors.ts'
import { maskFencedCode } from './markdownFences.ts'

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

/** Why a link was reported broken — additive on `BrokenLink` (issue #39):
 * `'path'` the target itself doesn't resolve (the original, only check);
 * `'anchor'` the target resolves but its `#heading` fragment doesn't;
 * `'line'` the target resolves but its `#L10`/`#L10-L20` fragment is out of range. */
export type BrokenReason = 'anchor' | 'line' | 'path'

export interface BrokenLink {
  readonly reason?: BrokenReason
  readonly suggestion?: string
  readonly target: string
  readonly text: string
}

export interface SuggestFixArgs {
  readonly fromDir: string
  readonly index: ReadonlyMap<string, readonly string[]>
  readonly target: string
}

/**
 * A checkable link whose target's existence and/or `#fragment` couldn't be
 * decided without IO — either the target resolves outside the eagerly-listed
 * `roots` (its existence itself is unknown), or it carries an anchor (its
 * validity needs the target's real content, which `checkContent` — pure and
 * IO-free — never reads for a file other than the one it's scanning). The
 * caller (../program/CheckLinks.ts) resolves these, bounded by `base`.
 */
export interface PendingCheck {
  /** `null` when the target itself has no `#fragment` — only existence (out of `roots`) is unresolved. */
  readonly anchor: string | null
  readonly fromDir: string
  readonly target: string
  readonly targetAbs: string
  readonly text: string
}

export interface CheckContentResult {
  readonly broken: readonly BrokenLink[]
  readonly pending: readonly PendingCheck[]
}

export interface CheckContentArgs {
  readonly content: string
  readonly existsAbs: (absPath: string) => boolean
  readonly fileAbs: string
  readonly index?: ReadonlyMap<string, readonly string[]>
  /** True for any absolute path inside the eagerly-listed `roots` (regardless
   * of whether it exists there) — lets `checkContent` tell "genuinely absent,
   * in-root" (resolvable now, no IO) apart from "outside `roots` entirely"
   * (existence itself unknown, deferred to `pending`). Defaults to "everything
   * is in-root", matching this function's original, `roots`-only behaviour. */
  readonly inRoots?: (absPath: string) => boolean
}

const LINK_RE = /!?\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
const INLINE_CODE_RE = /`[^`\n]*`/g

/**
 * Blank out fenced (``` / ~~~, via `maskFencedCode`) and inline (`code`)
 * spans so links that only appear inside code examples are NOT treated as
 * real links. Newlines are kept so line-based reasoning is unaffected; other
 * characters become spaces.
 */
export const stripCode = (content: string): string =>
  maskFencedCode(content).replaceAll(INLINE_CODE_RE, (block) => ' '.repeat(block.length))

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

/** True only for relative paths we can resolve on disk — INCLUDING a bare
 * `#heading` (same-page anchor), now checkable against the file's own
 * headings (issue #39, scenario C); previously always skipped. */
export const isCheckableTarget = (target: string): boolean => {
  if (!target) {
    return false
  }
  if (target.startsWith('//')) {
    return false
  } // protocol-relative URL
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) {
    return false
  } // http:, mailto:, etc.
  return true
}

export interface ParsedTarget {
  /** The raw text after `#`, or `null` if the target carries no fragment. */
  readonly anchor: string | null
  /** The target with `#anchor`/`?query` removed; `''` for a bare `#anchor`
   * (same-page fragment — the "path" is the current file itself). */
  readonly path: string
}

/** Split a link target into its path and (optional) `#anchor`, dropping any
 * `?query` — plain `indexOf`/`slice`, not a regex (CodeQL flagged the
 * previous `/\?.*$/` form as a polynomial-ReDoS risk on library input). */
export const parseTarget = (target: string): ParsedTarget => {
  const hashIdx = target.indexOf('#')
  const rawPath = hashIdx === -1 ? target : target.slice(0, hashIdx)
  const queryIdx = rawPath.indexOf('?')
  return {
    anchor: hashIdx === -1 ? null : target.slice(hashIdx + 1),
    path: queryIdx === -1 ? rawPath : rawPath.slice(0, queryIdx),
  }
}

/** Drop `#anchor` and `?query` from a target. */
export const stripAnchor = (target: string): string => parseTarget(target).path

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
 * Check one file's content for broken relative links, path existence and
 * `#fragment` validity. Resolves everything decidable without IO — an
 * in-`roots` path's existence (`existsAbs`, unchanged fast path) and a
 * same-page `#anchor` (the file's own content is already in hand, no IO
 * needed — issue #39 scenario C) — synchronously into `broken`. Anything
 * needing another file's content (a cross-file anchor, or a target outside
 * `roots` whose existence isn't yet known) is deferred into `pending` for the
 * caller (../program/CheckLinks.ts) to resolve with real, `base`-bounded IO.
 */
export const checkContent = ({
  content,
  existsAbs,
  fileAbs,
  index,
  inRoots = () => true,
}: CheckContentArgs): CheckContentResult => {
  const fromDir = path.dirname(fileAbs)
  const broken: BrokenLink[] = []
  const pending: PendingCheck[] = []
  const masked = stripCode(content)
  const candidates: MarkdownLink[] = [
    ...extractLinks(masked),
    // Reference-style definitions are checked by their target too.
    ...extractLinkDefinitions(masked).map((def) => ({ target: def.target, text: `[${def.label}]` })),
  ]

  let sourceAnchors: ReadonlySet<string> | null = null
  const getSourceAnchors = (): ReadonlySet<string> => (sourceAnchors ??= extractAnchors(content))

  for (const link of candidates) {
    if (!isCheckableTarget(link.target)) {
      continue
    }
    const { anchor, path: rel } = parseTarget(link.target)

    if (rel === '') {
      // Same-page anchor: no other file to read, resolve now.
      if (anchor !== null && !getSourceAnchors().has(anchor)) {
        broken.push({ reason: 'anchor', target: link.target, text: link.text })
      }
      continue
    }

    const abs = path.resolve(fromDir, rel)
    if (existsAbs(abs)) {
      if (anchor !== null) {
        pending.push({ anchor, fromDir, target: link.target, targetAbs: abs, text: link.text })
      }
      continue
    }
    if (!inRoots(abs)) {
      // Outside the eagerly-listed universe: existence itself is unknown —
      // never assume broken (issue #39 scenario E), defer to real IO.
      pending.push({ anchor, fromDir, target: link.target, targetAbs: abs, text: link.text })
      continue
    }
    // In `roots` and genuinely absent — `existsAbs` already covers the
    // complete in-root existence universe, no IO needed to know this.
    const suggestion = index ? suggestFix({ fromDir, index, target: link.target }) : null
    broken.push(
      suggestion
        ? { reason: 'path', suggestion, target: link.target, text: link.text }
        : { reason: 'path', target: link.target, text: link.text },
    )
  }
  return { broken, pending }
}
