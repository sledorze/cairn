// Pure, IO-free extraction of DECLARED `--refs` targets — issue #130's own
// proposed fix, scoped narrowly (see docs/design/137-typed-relations/,
// solution-space.md option B): a doc claims something about a file it has
// no reason to link (no `[text](path)` syntax makes sense for
// `package.json#files`'s membership, say) — this lets it name that target
// anyway, so `--refs`/`--stamp` can track drift on it exactly like a real
// link's target, with no predicate, no typed-object grammar, no evidence
// field. `CheckRefs.ts`'s `stampRefs` is the only caller; `checkRefs` needs
// no changes at all, since it only ever replays what `stampRefs` already
// wrote to the sidecar, regardless of how the target got there.
//
// Anchored in its OWN fenced block (an unrecognized info string, `cairn-refs`)
// rather than an inline HTML comment — verified (design package spike 1/2)
// that a comment is only PARTIALLY inert to `stripCode`/`extractProseRefs`
// today, while an unrecognized fenced info string is already fully invisible
// to every existing check with zero changes needed there.
//
// Fence-boundary detection deliberately mirrors `markdownFences.ts`'s own
// provably-linear line scan (not a regex — that file's own header explains
// why a lazy backreferenced regex here would be a real ReDoS risk) rather
// than importing its private helpers: this is the same shape applied to a
// different question (find one info-string-tagged fence's BODY lines,
// instead of masking every fence), and it's exactly two small helpers, not
// worth threading a shared abstraction through for a second call site yet.
//
// One deliberate DIVERGENCE from `markdownFences.ts`, found by adversarial
// review: that file's `fenceOpenMarker` is indentation-blind by design —
// masking a false-fence at 4+ spaces (CommonMark: an indented code block,
// not a real fence) only means treating a bit MORE content as inert, a safe
// direction to err in. Recognizing a fence HERE writes a `.cairn/refs/**`
// sidecar entry — the opposite risk — so this module requires at most 3
// leading spaces before the marker, matching CommonMark's actual
// fence-recognition rule, not `markdownFences.ts`'s looser one.

import type { Reference } from './MarkdownLinks.ts'
import { isCheckableTarget, parseTarget } from './MarkdownLinks.ts'

const DECLARED_REFS_INFO = 'cairn-refs'

// Deliberately STRICTER than `markdownFences.ts`'s own `fenceOpenMarker` on
// indentation: that file's masking is safe to over-trigger (masking an
// indented, non-fence line as "code" only means treating a bit more content
// as inert, never a false ENABLE). This module's job is the opposite risk —
// recognizing a fence here WRITES a `.cairn/refs/**` sidecar entry — so an
// indented (4+ space) line, which CommonMark itself does not treat as a
// fence marker at all (it's an indented code block instead), must not be
// mistaken for a live `cairn-refs` declaration: a doc illustrating this
// feature's own syntax inside an indented example (a nested bullet, a
// blockquote) must not silently start tracking a real target. At most 3
// leading spaces, matching CommonMark's own fence-recognition rule exactly.
const fenceOpenMarker = (line: string): '```' | '~~~' | null => {
  const leadingSpaces = line.length - line.trimStart().length
  if (leadingSpaces > 3) {
    return null
  }
  const trimmed = line.trimStart()
  if (trimmed.startsWith('```')) {
    return '```'
  }
  if (trimmed.startsWith('~~~')) {
    return '~~~'
  }
  return null
}

const fenceInfoString = (line: string, marker: string): string => line.trimStart().slice(marker.length).trim()

const isFenceClose = (line: string, marker: string): boolean => line.trim() === marker

/**
 * Extract every target declared inside a ` ```cairn-refs ``` ` fenced block
 * — one target per non-blank, non-`#`-comment line, in the same
 * `path` or `path#anchor` shape a real link's `href` already carries
 * (`parseTarget`, reused for consistency, not reinvented). Deduped by
 * `(target, anchor)`, same discipline `extractReferences` already uses.
 * An unclosed fence is treated as extending to end of document (matches
 * `maskFencedCode`'s own fail-safe: no stray content leaks as a "target").
 */
export const extractDeclaredRefs = (content: string): Reference[] => {
  const lines = content.split('\n')
  const refs: Reference[] = []
  const seen = new Set<string>()
  let i = 0
  while (i < lines.length) {
    const marker = fenceOpenMarker(lines[i] ?? '')
    if (marker === null) {
      i += 1
      continue
    }
    const info = fenceInfoString(lines[i] ?? '', marker)
    let j = i + 1
    while (j < lines.length && !isFenceClose(lines[j] ?? '', marker)) {
      j += 1
    }
    if (info === DECLARED_REFS_INFO) {
      for (let k = i + 1; k < j; k += 1) {
        const candidate = (lines[k] ?? '').trim()
        if (candidate === '' || candidate.startsWith('#')) {
          continue
        }
        if (!isCheckableTarget(candidate)) {
          continue
        }
        const { anchor, path: target } = parseTarget(candidate)
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
    }
    i = j < lines.length ? j + 1 : lines.length
  }
  return refs
}
