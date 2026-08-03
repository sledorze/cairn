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

// Same shape as MarkdownLinks.ts's own (private) LINK_RE — matches
// `[text](url)`/`![alt](url)`. Used only to MASK the text/alt span before
// candidate extraction (below), not to check the link itself.
//
// Quantifiers bounded at 2000 chars — this comment used to just note the
// shared shape; it shares LINK_RE's quadratic ReDoS too (verified
// empirically: ~4x time per 2x input on many unclosed-`[` content, same as
// LINK_RE's own pre-fix measurements), applied via `.replace` on real
// document prose. Found while auditing for siblings after CodeQL flagged
// LINK_RE, not by CodeQL itself flagging this file.
const LINK_TEXT_RE = /!?\[([^\]]{0,2000})\]\([^)\s]{1,2000}(?:\s+"[^"]{0,2000}")?\)/g

/**
 * A backtick-styled citation inside a REAL Markdown link's text —
 * `` [`src/x.ts`](../src/x.ts) `` — is already `CheckLinks.ts`'s concern,
 * not this module's: found via dimension-coverage review that without this,
 * an already-broken real link got reported TWICE (once by the link checker,
 * once again by `--prose-refs` suggesting the exact link that already
 * exists and is already broken) — directly undercutting this check's own
 * purpose as a DISTINCT concern from `CheckLinks.ts`, not a duplicate of
 * it. Masking the link TEXT span (not the whole link — the URL itself may legitimately differ
 * from the citation) before candidate extraction removes the double-report
 * at the source, the same masking discipline `maskFencedCode` already uses.
 */
const maskLinkText = (masked: string): string =>
  masked.replace(LINK_TEXT_RE, (whole: string, text: string) => {
    // `text` (the regex's one capture group) starts immediately after the
    // `[` — reliable even when `text` is empty or repeats elsewhere in
    // `whole`, unlike an `indexOf(text)` search would be.
    const textStart = whole.indexOf('[') + 1
    return whole.slice(0, textStart) + ' '.repeat(text.length) + whole.slice(textStart + text.length)
  })

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
  // An absolute path (`/etc/nginx/nginx.conf`) is a real filesystem path,
  // not a repo-rooted one — the issue's own term "rooted repo path" means
  // relative to the repo root, not the OS root. Found via dimension-
  // coverage review: without this, an absolute-path citation silently
  // joined onto `base` and produced a nonsensical suggested link.
  if (trimmed.startsWith('/')) {
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
  const masked = maskLinkText(maskFencedCode(content))
  const refs: ProseRef[] = []
  for (const match of masked.matchAll(INLINE_CODE_CAPTURE_RE)) {
    const captureStart = (match.index ?? 0) + 1 // +1 skips the opening backtick
    const captureLength = match[1]?.length ?? 0
    const text = content.slice(captureStart, captureStart + captureLength)
    if (looksLikeRootedPath(text)) {
      // `looksLikeRootedPath` decides candidacy on the TRIMMED form, but a
      // real bug (found via adversarial dimension-coverage review, not the
      // original test pass) pushed the untrimmed `text` — an ordinary
      // citation with trailing whitespace inside the backticks (easy to
      // introduce by accident, e.g. `` `src/x.ts ` ``) resolved fine as a
      // trimmed path yet was checked/reported as the UNTRIMMED string,
      // which never resolves — a false positive on ordinary input,
      // violating this feature's own load-bearing "resolves ⇒ always
      // silent" guarantee.
      refs.push({ text: text.trim() })
    }
  }
  return refs
}
