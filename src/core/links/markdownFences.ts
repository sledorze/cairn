// Fenced (``` / ~~~) code block masking — a provably linear line scan, not a
// single regex. The prior single-regex form
// (`/(^|\n)[ \t]*(```|~~~)[\s\S]*?\n[ \t]*\2[ \t]*(?=\n|$)/g`) is a genuine
// CodeQL js/polynomial-redos finding: a lazy `[\s\S]*?` hunting for a
// backreferenced closing marker is O(n^2) on adversarial input (many
// unclosed or repeated fence markers) — exactly the kind of untrusted
// document content `cairn check` runs over in CI. Shared by
// MarkdownLinks.ts (stripCode) and Anchors.ts (heading extraction must not
// misparse a heading-shaped line inside a fence).

const fenceOpenMarker = (line: string): '```' | '~~~' | null => {
  const trimmed = line.trimStart()
  if (trimmed.startsWith('```')) {
    return '```'
  }
  if (trimmed.startsWith('~~~')) {
    return '~~~'
  }
  return null
}

/** A closing fence line is the marker alone, with only surrounding whitespace. */
const isFenceClose = (line: string, marker: string): boolean => line.trim() === marker

/**
 * Replace every character of each fenced code block — opening and closing
 * marker lines included — with a space, keeping line count/newlines intact.
 * An unclosed fence masks to end of document (matches the prior regex's own
 * behaviour, which also never matched — and so never masked — an unclosed
 * fence... this instead fails safe: unterminated is treated as "still in
 * code," not leaking a stray marker line as real content).
 */
export const maskFencedCode = (content: string): string => {
  const lines = content.split('\n')
  let i = 0
  while (i < lines.length) {
    const marker = fenceOpenMarker(lines[i] ?? '')
    if (marker === null) {
      i += 1
      continue
    }
    let j = i + 1
    while (j < lines.length && !isFenceClose(lines[j] ?? '', marker)) {
      j += 1
    }
    const end = j < lines.length ? j : lines.length - 1
    for (let k = i; k <= end; k += 1) {
      lines[k] = ' '.repeat((lines[k] ?? '').length)
    }
    i = end + 1
  }
  return lines.join('\n')
}
