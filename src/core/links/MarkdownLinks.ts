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
// alternative (`[^)\s]{1,2000}`, tried only when the destination does NOT
// start with `<`) stops at the first unescaped `)` or whitespace, same as
// before — that heuristic is correct for the unwrapped form and
// deliberately untouched; it must never run against a `<...>`-delimited
// destination, which reads verbatim up to its own matching `>` first.
//
// The angle-bracket content is a SINGLE negated character class
// (`[^<>\n]{0,2000}`), not an alternation of overlapping classes (e.g.
// `(?:[^<>\\\n]|\\.)*` for `\>`-escape support) — CommonMark's own escape
// support inside `<...>` isn't something the bug this fixes (angle-wrapped
// URLs with parens) ever needed, and an alternation shape here would add
// back exactly the ambiguity the bound below exists to eliminate.
//
// Every unbounded `*`/`+` in this regex is capped at a generous-but-finite
// length (link text and destinations are realistically well under 2000
// chars — beyond that, a bounded miss is an acceptable trade-off, not a
// silent truncation of anything a real doc would contain). This is a REAL
// fix, not a defensive guess: CodeQL's `js/polynomial-redos` flagged this
// exact regex — including its PRE-EXISTING, unbounded text/bare-destination
// groups, present before this file's angle-bracket support was ever added —
// and it was verified empirically, not just by the analyzer's say-so: fed
// `"\\[".repeat(n)` (many escaped-looking opens, no closing `]` anywhere),
// the unbounded form scaled quadratically (~4x time per 2x input, confirmed
// at n up to 40 000), while every bounded quantifier below make it linear
// (confirmed same input scaling 2x time per 2x input, up to n = 160 000).
// The quadratic blowup is structural, not a `<...>`-alternation artifact —
// `matchAll` retries the whole pattern at every start position in an
// unclosed-bracket string, and each retry costs O(remaining length)
// regardless of backtracking; only a length cap turns each retry's cost
// into a constant, restoring overall linear behaviour.
const LINK_RE = /!?\[([^\]]{0,2000})\]\((?:<([^<>\n]{0,2000})>|([^)\s]{1,2000}))(?:\s+"[^"]{0,2000}")?\)/g
const BACKTICK_RUN_RE = /`+/g

/** A `LINK_RE` match's destination is in capture group 2 (angle-bracket form)
 * or group 3 (bare form) depending on which alternative matched — never both,
 * and never NEITHER: the angle form requires `<`...`>` (an empty destination,
 * `<>`, still captures `''`, not `undefined`) and the bare form requires
 * `[^)\s]+` (one-or-more, so it can never capture an empty string). Whichever
 * alternative participates in a successful overall match always leaves a
 * defined string in one of the two groups — a structural guarantee of the
 * regex, not a runtime possibility a fallback needs to defend against. */
const linkTarget = (match: RegExpMatchArray): string => (match[2] ?? match[3]) as string

/** One run of consecutive backtick characters — CommonMark's actual code-span
 * delimiter is a backtick RUN of some length, not a single backtick. */
interface BacktickRun {
  readonly end: number
  readonly length: number
  readonly start: number
}

/** Blank `[start, end)` of `chars` in place, preserving newlines (same
 * contract `stripCode`'s own docstring states) and total length exactly —
 * callers downstream (`extractLinksWithPosition` -> `DocMetadata.ts`'s
 * `offsetToLine`) rely on masked-content offsets lining up 1:1 with the
 * ORIGINAL content's own line-start table, so this must never change the
 * document's length or line count. `chars` is a `string.split('')` array —
 * UTF-16 code UNIT indexed, matching `.length`/regex `.index`, deliberately
 * NOT `[...str]`'s code-POINT iteration, which would silently shrink the
 * output — and shift every later offset — the moment a masked span contains
 * an astral character. */
const blank = (chars: string[], start: number, end: number): void => {
  for (let i = start; i < end; i += 1) {
    if (chars[i] !== '\n') {
      chars[i] = ' '
    }
  }
}

/**
 * Mask CommonMark-style inline code spans (`` `code` ``, ``` ``code`` ```,
 * ...) across the WHOLE document, not line by line (issue #180) — a code
 * span opened on one line and closed on a later one is ordinary Markdown
 * reflow, and CommonMark's own rule has no same-line restriction: a span is
 * delimited by a backtick RUN, and closes at the NEXT run of EQUAL length,
 * wherever that falls. The prior single-regex form (`` /`[^`\n]*`/g `` )
 * could never match across a `\n`, so a wrapped span's true closer was
 * invisible to it — the scan instead re-paired the OPENING run against
 * whichever backtick happened to come next on the CLOSING line, silently
 * swallowing whatever (a real link, among other things) sat between them.
 *
 * Implemented as a single forward pass over the backtick-RUN list (not a
 * backtracking regex over the whole document): for each run not yet
 * consumed, scan forward for the next run of the same length; found ->
 * that's the closer, mask between them (inclusive) and continue after it;
 * not found -> this run is literal (an unterminated span opener never masks
 * anything, matching CommonMark), advance by one run. Worst case is
 * O(runs^2) if many runs never find a same-length partner — a categorically
 * different, far smaller risk than `LINK_RE`'s own bounded quantifiers exist
 * to defend against (adversarial UNCLOSED-bracket input driving regex
 * backtracking): `runs` here is a document's inline-code-marker count
 * (realistically low double digits at most), not attacker-controlled
 * bracket repetition, so no length cap is needed.
 */
const maskInlineCode = (content: string): string => {
  // A manual `.exec()` loop, not `[...content.matchAll(...)]`: TS's own lib
  // types make `RegExpExecArray.index` (`.exec()`'s return type) a plain
  // `number`, while `RegExpMatchArray.index` (`matchAll`'s) is `number |
  // undefined` — the same runtime guarantee either way (a real match always
  // has a numeric index), but `.exec()`'s typing needs neither a `?? 0`
  // fallback (an unreachable branch no real input can take, `??`'s own
  // downside — see `extractLinkDefinitionsWithPosition`'s comment) nor an
  // `as` assertion to get there. `lastIndex` reset first since
  // `BACKTICK_RUN_RE` is a shared, stateful `g`-flag regex.
  const runs: BacktickRun[] = []
  BACKTICK_RUN_RE.lastIndex = 0
  for (let m = BACKTICK_RUN_RE.exec(content); m !== null; m = BACKTICK_RUN_RE.exec(content)) {
    const start = m.index
    runs.push({ end: start + m[0].length, length: m[0].length, start })
  }
  // `content.split('')`, not `[...content]` (oxlint's own `unicorn/prefer-spread`
  // would rather see the latter) — this MUST stay UTF-16 code-UNIT indexed to
  // match `blank`'s `start`/`end` (regex `.index`-derived); the spread form is
  // code-POINT indexed and silently shrinks + misaligns the array the moment an
  // astral character (e.g. an emoji) appears anywhere earlier in the document —
  // confirmed for real (see `blank`'s own comment): a genuine correctness bug
  // this file's own oxlint autofix has re-introduced more than once.
  // oxlint-disable-next-line unicorn/prefer-spread
  const chars = content.split('')
  // `runs.entries()` (real element type, never `BacktickRun | undefined`)
  // instead of manual `runs[i]` indexing — `noUncheckedIndexedAccess` makes
  // every indexed access possibly-`undefined` even where the loop's own
  // bound already guarantees otherwise, which would leave a defensive
  // branch no real input can ever reach (a bug class this codebase treats
  // as a real defect, not just untested code — a still-reachable branch
  // deserves a real test, an UNREACHABLE one deserves not existing).
  let skipUntil = 0
  for (const [i, opener] of runs.entries()) {
    if (i < skipUntil) {
      continue
    }
    const closer = runs.slice(i + 1).find((run) => run.length === opener.length)
    if (closer !== undefined) {
      blank(chars, opener.start, closer.end)
      skipUntil = runs.indexOf(closer) + 1
    }
  }
  return chars.join('')
}

/**
 * Blank out fenced (``` / ~~~, via `maskFencedCode`) and inline (`code`)
 * spans so links that only appear inside code examples are NOT treated as
 * real links. Newlines are kept so line-based reasoning is unaffected; other
 * characters become spaces.
 */
export const stripCode = (content: string): string => maskInlineCode(maskFencedCode(content))

const LINK_DEF_RE = /^[ \t]*\[([^\]]+)\]:[ \t]*<?([^>\s]+)>?/gm

/** Extract inline Markdown links/images as `{ target, text }`. */
export const extractLinks = (content: string): MarkdownLink[] => {
  const links: MarkdownLink[] = []
  for (const match of content.matchAll(LINK_RE)) {
    links.push({ target: linkTarget(match), text: match[1] ?? '' })
  }
  return links
}

export interface PositionedLink extends MarkdownLink {
  /** Character offset (0-indexed) of the whole match's start (the `!`/`[`),
   * into the SAME `content` string passed in — a caller converts this to a
   * line number itself (e.g. `../structure/DocMetadata.ts`'s `offsetToLine`);
   * this module stays position-format-agnostic. */
  readonly index: number
}

/** Like `extractLinks`, plus each link's character offset — additive, not a
 * replacement: `extractLinks` itself is untouched (still no position field),
 * so every existing caller is unaffected. Kept as its own function rather
 * than adding an optional field to `extractLinks`'s result, so callers that
 * don't need position pay no cost and get no new field to ignore. */
export const extractLinksWithPosition = (content: string): PositionedLink[] => {
  const links: PositionedLink[] = []
  for (const match of content.matchAll(LINK_RE)) {
    links.push({ index: match.index ?? 0, target: linkTarget(match), text: match[1] ?? '' })
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

export interface PositionedLinkDef extends MarkdownLinkDef {
  /** Same contract as `PositionedLink.index` — a caller converts this to a
   * line number itself. */
  readonly index: number
}

/** Like `extractLinkDefinitions`, plus each definition's character offset —
 * additive, mirroring `extractLinksWithPosition`'s own relationship to
 * `extractLinks`. A reference-style link (`[text][ref]` + `[ref]: target`)
 * has no target text at its OWN usage site — the definition line is the
 * only place a target/position pair exists, so a position-aware consumer
 * that wants reference-style links (e.g. `../structure/DocMetadata.ts`'s
 * `ref` nodes) needs this, not `extractLinksWithPosition` alone. */
export const extractLinkDefinitionsWithPosition = (content: string): PositionedLinkDef[] => {
  const defs: PositionedLinkDef[] = []
  for (const match of content.matchAll(LINK_DEF_RE)) {
    // Groups 1 (label) and 2 (target) are both `+` (one-or-more) in
    // LINK_DEF_RE — a successful match always captures both, never
    // `undefined`; `match.index` is likewise always a number for a
    // `matchAll` result (TS's `RegExpMatchArray` type is conservative
    // here, not the runtime reality) — same structural guarantee
    // `linkTarget`'s own comment documents for `LINK_RE`'s groups. `as`,
    // not `??`, so this never introduces a branch no real input can take.
    defs.push({ index: match.index as number, label: match[1] as string, target: match[2] as string })
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
