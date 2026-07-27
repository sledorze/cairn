// Pure, IO-free helpers to find and auto-repair relative Markdown links.
// All functions here are deterministic and unit-tested in MarkdownLinks.unit.test.ts.
// The Effect program that touches the filesystem lives in ../program/CheckLinks.ts.

import * as nodePath from 'node:path'

import { describeAnchors, extractAnchors, normalizeAnchor, suggestAnchorFix } from './Anchors.ts'
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
  /** Short, human-readable elaboration — what's actually there instead, so
   * fixing this doesn't require opening the target file first. E.g. for
   * `reason: 'anchor'`, the target's real headings; for `reason: 'line'`,
   * the target's real line count. */
  readonly detail?: string
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

// Destination alternation: CommonMark lets a destination be wrapped in
// `<...>` specifically so it can contain characters — most commonly `)` —
// that would otherwise be ambiguous with the link's own closing paren (e.g.
// `[t](<https://example.com/path_(with_parens)/more>)`, a real, valid,
// not-uncommon shape for Wikipedia/LibreTexts-style URLs). The bare-form
// alternative (`[^)\s]+`, tried only when the destination does NOT start
// with `<`) stops at the first unescaped `)` or whitespace, same as before —
// that heuristic is correct for the unwrapped form and deliberately
// untouched; it must never run against a `<...>`-delimited destination,
// which reads verbatim up to its own matching `>` first.
//
// The angle-bracket content is a SINGLE negated character class (`[^<>\n]*`),
// not an alternation of overlapping classes (e.g. `(?:[^<>\\\n]|\\.)*` for
// `\>`-escape support) — CodeQL flags that alternation shape as a polynomial-
// ReDoS risk on library input, even though this particular pair is actually
// disjoint per character (verified empirically: no slowdown on an adversarial
// input). Simpler and provably linear beats arguing with the analyzer, and
// CommonMark's own escape support inside `<...>` isn't something the bug this
// fixes (issue: angle-wrapped URLs with parens) ever needed.
const LINK_RE = /!?\[([^\]]*)\]\((?:<([^<>\n]*)>|([^)\s]+))(?:\s+"[^"]*")?\)/g
const INLINE_CODE_RE = /`[^`\n]*`/g

/** A `LINK_RE` match's destination is in capture group 2 (angle-bracket form)
 * or group 3 (bare form) depending on which alternative matched — never both,
 * and never NEITHER: the angle form requires `<`...`>` (an empty destination,
 * `<>`, still captures `''`, not `undefined`) and the bare form requires
 * `[^)\s]+` (one-or-more, so it can never capture an empty string). Whichever
 * alternative participates in a successful overall match always leaves a
 * defined string in one of the two groups — a structural guarantee of the
 * regex, not a runtime possibility a fallback needs to defend against. */
const linkTarget = (match: RegExpMatchArray): string => (match[2] ?? match[3]) as string

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
    links.push({ target: linkTarget(match), text: match[1] ?? '' })
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

/** Start offset of a regex match's first capture group, given the group's
 * own text starts right after the FIRST `[` in the whole match (true for
 * both `LINK_RE`'s text group and `LINK_DEF_RE`'s label group). */
const captureGroupStart = (match: RegExpMatchArray): number => (match.index ?? 0) + match[0].indexOf('[') + 1

/**
 * Like `extractLinks`, but matches against `masked` (to keep the existing
 * "a link written inside a code example isn't a real link" exclusion,
 * unchanged) while reading the TEXT back from `original` at that same
 * position. Without this, a link whose own visible text is itself
 * backtick-styled (e.g. `` [`glob.ts`](../glob.ts) ``) reports as blank —
 * `stripCode`'s inline-code masking blanks that backtick span before
 * extraction ever sees it, since it can't distinguish "styling inside a
 * link's text" from "a link written inside a code example." Errors need the
 * real text to be actionable, so this is a position-preserving re-read, not a
 * masking change (masking's own exclusion behaviour must stay exactly as-is).
 */
const extractLinksPreservingText = (original: string, masked: string): MarkdownLink[] => {
  const links: MarkdownLink[] = []
  for (const match of masked.matchAll(LINK_RE)) {
    const textStart = captureGroupStart(match)
    const textLength = match[1]?.length ?? 0
    links.push({ target: linkTarget(match), text: original.slice(textStart, textStart + textLength) })
  }
  return links
}

/** The `extractLinkDefinitions` counterpart of `extractLinksPreservingText`. */
const extractLinkDefinitionsPreservingLabel = (original: string, masked: string): MarkdownLinkDef[] => {
  const defs: MarkdownLinkDef[] = []
  for (const match of masked.matchAll(LINK_DEF_RE)) {
    const labelStart = captureGroupStart(match)
    const labelLength = match[1]?.length ?? 0
    defs.push({ label: original.slice(labelStart, labelStart + labelLength), target: match[2] ?? '' })
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

export interface Reference {
  readonly anchor: string | null
  readonly target: string
}

/**
 * Every real (checkable, cross-file) reference a doc makes — deduped by
 * `(target, anchor)` — for issue #39 Scenario I's content-hash drift
 * tracking (`../program/CheckRefs.ts`). Same-page anchors (`path === ''`)
 * are excluded: a same-page fragment isn't a reference to another file's
 * content, it's a position within this one — `checkContent`'s own anchor
 * check already covers whether it resolves.
 */
export const extractReferences = (content: string): Reference[] => {
  const masked = stripCode(content)
  const candidates: MarkdownLink[] = [
    ...extractLinks(masked),
    ...extractLinkDefinitions(masked).map((def) => ({ target: def.target, text: '' })),
  ]
  const seen = new Set<string>()
  const refs: Reference[] = []
  for (const link of candidates) {
    if (!isCheckableTarget(link.target)) {
      continue
    }
    const { anchor, path: target } = parseTarget(link.target)
    if (target === '') {
      continue
    }
    const key = `${target}#${anchor ?? ''}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    refs.push({ anchor, target })
  }
  return refs
}

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
    ...extractLinksPreservingText(content, masked),
    // Reference-style definitions are checked by their target too.
    ...extractLinkDefinitionsPreservingLabel(content, masked).map((def) => ({
      target: def.target,
      text: `[${def.label}]`,
    })),
  ]

  let sourceAnchors: ReadonlySet<string> | null = null
  const getSourceAnchors = (): ReadonlySet<string> => (sourceAnchors ??= extractAnchors(content))

  for (const link of candidates) {
    if (!isCheckableTarget(link.target)) {
      continue
    }
    const { anchor, path: rel } = parseTarget(link.target)

    if (rel === '') {
      // Same-page anchor: no other file to read, resolve now. Normalized
      // (percent-decoded) the same way the cross-file path already does
      // (CheckLinks.ts's `normalizeAnchor(item.anchor)`) — found as a real
      // asymmetry via adversarial review of issue #49: a URL-encoded
      // same-page fragment (`#Setup%2DPattern`) was being compared/matched
      // against RAW anchor text, so it neither resolved when it should have
      // nor got an anchor-fix suggestion, while the equivalent cross-file
      // link did both correctly.
      const normalized = anchor === null ? null : normalizeAnchor(anchor)
      if (normalized !== null && !getSourceAnchors().has(normalized)) {
        // Issue #49: an exact case-insensitive match against the source's
        // OWN headings is repairable the same way a moved-file path is —
        // the suggestion is the FULL corrected target (`#realSlug`), so
        // `applyFix`'s existing occurrence-safe whole-target replacement
        // handles it with no new repair machinery.
        const fixedAnchor = suggestAnchorFix(normalized, getSourceAnchors())
        broken.push({
          detail: describeAnchors(getSourceAnchors()),
          reason: 'anchor',
          ...(fixedAnchor === null ? {} : { suggestion: `#${fixedAnchor}` }),
          target: link.target,
          text: link.text,
        })
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
