// Pure, IO-free extraction of the anchor set a Markdown document exposes —
// heading-derived slugs (GitHub's own algorithm, via the `github-slugger`
// package it stays in sync with) plus explicit HTML anchors — and validation
// of GitHub-style line anchors (`#L10`, `#L10-L20`). Used by ../program/
// CheckLinks.ts to validate `#fragment` links (issue #39).

import GithubSlugger from 'github-slugger'

import { maskFencedCode } from './markdownFences.ts'

const ATX_RE = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/
const SETEXT_RE = /^(=+|-+)[ \t]*$/
const HTML_ANCHOR_RE = /<a\s+(?:[^>]*?\s)?(?:name|id)=["']([^"']+)["']/gi
// Reduce an inline link/image inside a heading to its own text/alt — GitHub's
// rendering pipeline resolves these before computing the anchor.
//
// Quantifiers bounded at 2000 chars — same fix, same reason, as
// `MarkdownLinks.ts`'s own `LINK_RE`: this is a structurally identical
// pattern (`[^\]]*` text + `[^)\s]+` destination, no `^` anchor, applied via
// `replaceAll` on real heading text), so it has the exact same quadratic
// ReDoS shape (verified empirically: ~4x time per 2x input on many
// unclosed-`[` content, matching `LINK_RE`'s own pre-fix measurements) —
// found while auditing for siblings after CodeQL flagged `LINK_RE`, not by
// CodeQL itself flagging this file.
const HEADING_LINK_RE = /!?\[([^\]]{0,2000})\]\([^)\s]{1,2000}(?:\s+"[^"]{0,2000}")?\)/g

const ENTITY_MAP: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  quot: '"',
}

/** Minimal HTML entity decode (the named entities real docs plausibly use,
 * plus numeric/hex forms) — not a full HTML decoder, matching this codebase's
 * hand-rolled-regex house style rather than pulling in an entities library. */
const decodeEntities = (text: string): string =>
  text.replaceAll(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole: string, body: string) => {
    if (body.startsWith('#')) {
      const codePoint =
        body[1]?.toLowerCase() === 'x' ? Number.parseInt(body.slice(2), 16) : Math.trunc(Number(body.slice(1)))
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : whole
    }
    return ENTITY_MAP[body.toLowerCase()] ?? whole
  })

const flattenInlineLinks = (headingText: string): string =>
  headingText.replaceAll(HEADING_LINK_RE, (_whole: string, text: string) => text)

/** Heading text, in document order, from ATX (`# H`) and setext (`H\n===`)
 * headings. `masked` must already have fenced code blanked (see `maskFencedCode`) —
 * a setext underline requires the line above to be non-blank, non-heading
 * text, so a thematic break (`---` after a blank line) is never mistaken for
 * a setext heading. */
const extractHeadingTexts = (masked: string): string[] => {
  const lines = masked.split('\n')
  const headings: string[] = []
  for (const [i, line] of lines.entries()) {
    const atx = ATX_RE.exec(line ?? '')
    if (atx) {
      headings.push(atx[2] ?? '')
      continue
    }
    if (i > 0 && SETEXT_RE.test(line ?? '')) {
      const prev = lines[i - 1] ?? ''
      if (prev.trim() !== '' && !ATX_RE.test(prev) && !SETEXT_RE.test(prev)) {
        headings.push(prev.trim())
      }
    }
  }
  return headings
}

/**
 * The full set of valid `#fragment` targets for a document: every heading's
 * GitHub-slugged text (deduped in document order via `github-slugger`'s own
 * `-1`/`-2`... numbering, which re-checks each numbered candidate against the
 * seen set rather than incrementing once) plus every explicit `<a id="...">`/
 * `<a name="...">` HTML anchor (kept verbatim, not slugged — GitHub honours
 * these as-authored).
 */
export const extractAnchors = (content: string): ReadonlySet<string> => {
  const masked = maskFencedCode(content)
  const slugger = new GithubSlugger()
  const anchors = new Set<string>()
  for (const raw of extractHeadingTexts(masked)) {
    const flattened = decodeEntities(flattenInlineLinks(raw))
    anchors.add(slugger.slug(flattened))
  }
  for (const match of masked.matchAll(HTML_ANCHOR_RE)) {
    if (match[1]) {
      anchors.add(match[1])
    }
  }
  return anchors
}

/** `decodeURIComponent`, tolerant of malformed input (returns the input
 * unchanged rather than throwing) — anchors in authored links are usually
 * plain text, but may be percent-encoded. */
export const normalizeAnchor = (anchor: string): string => {
  try {
    return decodeURIComponent(anchor)
  } catch {
    return anchor
  }
}

export interface LineRange {
  readonly end: number
  readonly start: number
}

const LINE_ANCHOR_RE = /^L(\d+)(?:-L(\d+))?$/

/** Parse a GitHub-style line anchor (`L10`, `L10-L20`). `null` for anything
 * else, including an inverted range (`L20-L10`) or a non-positive line. */
export const parseLineAnchor = (anchor: string): LineRange | null => {
  const match = LINE_ANCHOR_RE.exec(anchor)
  if (!match) {
    return null
  }
  const start = Number(match[1])
  const end = match[2] === undefined ? start : Number(match[2])
  return start >= 1 && end >= start ? { end, start } : null
}

/** True when `range` falls within a file of `lineCount` lines (1-indexed, inclusive). */
export const isValidLineAnchor = (range: LineRange, lineCount: number): boolean => range.end <= lineCount

/**
 * Suggest a repaired anchor for a broken `#fragment` — issue #49. Exactly
 * one real anchor whose OWN lowercased form equals the broken fragment's
 * lowercased form: GitHub heading slugs are always already lowercase, so
 * this is a well-defined "case-insensitive exact match," not a fuzzy
 * heuristic (deliberately narrower than the original "fuzzy" proposal —
 * see the issue's own review notes: a wrong-but-similar match would
 * confidently repair a link to the WRONG heading, hiding the real problem
 * behind a green check, which is worse than leaving it broken).
 *
 * Comparing every entry's OWN lowercased form (not just `available.has
 * (lower)`) matters because explicit `<a id="...">` anchors are kept
 * VERBATIM, not lowercased (`extractAnchors`'s own contract) — two
 * differently-cased real anchors (`<a id="Foo">` and `<a id="foo">`, or an
 * HTML anchor case-colliding with a heading slug) are a real, if rare,
 * ambiguity a plain `Set.has` lookup can't see. Two or more matches means
 * "unrepairable, still report broken" — the same ambiguity guard
 * `suggestFix`'s own `candidates.length !== 1` check already uses for path
 * repair, applied here instead of a coin-flip pick.
 */
export const suggestAnchorFix = (anchor: string, available: ReadonlySet<string>): string | null => {
  const lower = anchor.toLowerCase()
  const matches = [...available].filter((candidate) => candidate.toLowerCase() === lower)
  return matches.length === 1 ? (matches[0] ?? null) : null
}

const MAX_LISTED_ANCHORS = 8

/**
 * Human-readable summary of a document's available anchors, for actionable
 * error messages — what's actually there, so fixing a broken `#fragment`
 * doesn't require opening the target file first. Capped so a document with
 * hundreds of headings doesn't produce an unreadable wall of text.
 */
export const describeAnchors = (anchors: ReadonlySet<string>): string => {
  if (anchors.size === 0) {
    return 'target has no headings or anchors'
  }
  const list = [...anchors]
  const shown = list.slice(0, MAX_LISTED_ANCHORS)
  const suffix = list.length > MAX_LISTED_ANCHORS ? `, and ${list.length - MAX_LISTED_ANCHORS} more` : ''
  return `available anchors: ${shown.join(', ')}${suffix}`
}
