// Pure, IO-free extraction of bare-backtick file-path citations in Markdown
// prose (issue #47) — a citation like `` `src/services/auth.ts` `` with no
// `[text](path)` syntax at all, invisible to `checkContent`/`extractLinks`
// (those only ever match `[text](path)`/`[label]: path`). Fenced code blocks
// are masked first — same `maskFencedCode` masking `stripCode` uses — so an
// illustrative code example never becomes a candidate; matches are
// position-preserving (real text read back from the ORIGINAL content), the
// same discipline `extractLinksPreservingText` already established.
//
// This is deliberately narrow: it only decides "does this backtick string
// LOOK like a rooted repo path worth checking" (`looksLikeRootedPath`) — the
// existence check itself, and the base-boundary security discipline, live in
// `../../program/links/CheckProseRefs.ts`, reusing #39/#40's `isWithinBase`
// rather than inventing a second containment rule.

import { maskFencedCode } from './markdownFences.ts'

export interface ProseRef {
  readonly text: string
}

const INLINE_CODE_CAPTURE_RE = /`([^`\n]+)`/g

// Glob/template characters and a scheme separator both signal "not a literal
// repo-relative path" — issue #47 criterion 5.
const NON_PATH_CHARS_RE = /[*?{}<>]|:\/\//

/**
 * A bare filename with an extension but no path segment (`package.json`,
 * `.env`) is common enough as an ordinary word in prose that it's excluded
 * outright (issue #47 criterion 5) — a candidate must contain at least one
 * `/` to even be considered. Whitespace inside the backticks (multi-word
 * code spans, e.g. `` `npm install` ``) is never a path either.
 */
export const looksLikeRootedPath = (candidate: string): boolean => {
  const trimmed = candidate.trim()
  if (trimmed.length === 0 || !trimmed.includes('/')) {
    return false
  }
  if (NON_PATH_CHARS_RE.test(trimmed) || /\s/.test(trimmed)) {
    return false
  }
  // A "rooted" repo path (the issue's own term) is read from the repo root —
  // `./`/`../`-prefixed text uses RELATIVE addressing instead (relative to
  // whatever the surrounding prose is talking about, not the repo root), a
  // different convention this feature doesn't attempt to interpret. Found
  // as a real false positive via the false-positive sweep against this
  // repo's own docs (`../sidecar.ts`, a legitimate same-directory
  // cross-reference in prose, not a repo-rooted citation).
  if (trimmed.startsWith('.')) {
    return false
  }
  // A bare directory/module mention (`core/`, `links/`) has no filename to
  // actually check — also found via the same sweep, extremely common
  // shorthand for "the X module," not a specific file citation.
  if (trimmed.endsWith('/')) {
    return false
  }
  return true
}

/** Every inline-code-span citation in `content` that looks like a rooted
 * repo path, outside fenced code blocks. Does not check existence — pure
 * candidate extraction only. */
export const extractProseRefs = (content: string): readonly ProseRef[] => {
  const masked = maskFencedCode(content)
  const refs: ProseRef[] = []
  for (const match of masked.matchAll(INLINE_CODE_CAPTURE_RE)) {
    const captureStart = (match.index ?? 0) + 1 // +1 skips the opening backtick
    const captureLength = match[1]?.length ?? 0
    const text = content.slice(captureStart, captureStart + captureLength)
    if (looksLikeRootedPath(text)) {
      refs.push({ text })
    }
  }
  return refs
}
