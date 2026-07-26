import { describe, expect, it } from 'vitest'

import { maskFencedCode } from './markdownFences.ts'

describe('maskFencedCode()', () => {
  it('blanks a fenced block, opening/closing markers included, keeping newlines', () => {
    const md = 'before\n```md\n[x](./nope.md)\n```\nafter'
    const masked = maskFencedCode(md)
    expect(masked).not.toContain('```')
    expect(masked).not.toContain('[x](./nope.md)')
    expect(masked).toContain('before')
    expect(masked).toContain('after')
    expect(masked.split('\n')).toHaveLength(md.split('\n').length)
  })

  it('supports ~~~ fences', () => {
    const md = '~~~\nhidden\n~~~\nvisible'
    const masked = maskFencedCode(md)
    expect(masked).not.toContain('hidden')
    expect(masked).toContain('visible')
  })

  it('does not close a fence on a line with trailing content after the marker', () => {
    // Matches the prior regex's own semantics: a closing line must be the
    // marker alone (plus whitespace) — "```js" mid-block is just more
    // fenced content, not an accidental close.
    const md = '```\ninside\n```js\nstill inside\n```\nafter'
    const masked = maskFencedCode(md)
    expect(masked).not.toContain('inside')
    expect(masked).toContain('after')
  })

  it('leaves content with no fences untouched', () => {
    expect(maskFencedCode('just prose, no fences')).toBe('just prose, no fences')
  })

  it('masks to end of document when a fence is never closed, rather than leaving it unmasked', () => {
    const md = 'before\n```\n[x](./nope.md)\nmore code\nno close here'
    const masked = maskFencedCode(md)
    expect(masked).toContain('before')
    expect(masked).not.toContain('[x](./nope.md)')
    expect(masked).not.toContain('no close here')
  })

  it('handles back-to-back fenced blocks independently', () => {
    const md = '```\na\n```\ntext\n```\nb\n```'
    const masked = maskFencedCode(md)
    expect(masked).not.toContain('a')
    expect(masked).not.toContain('b')
    expect(masked).toContain('text')
  })

  it('handles an empty string', () => {
    expect(maskFencedCode('')).toBe('')
  })

  // The construction-based proof this fix exists for: CodeQL's own repro
  // shape for the prior single-regex implementation ("strings starting with
  // ``` and many repetitions of \n```") — many unclosed/repeated fence
  // markers. A quadratic implementation would visibly stall here; a linear
  // one completes near-instantly. Asserts on wall-clock, generously bounded
  // (not a tight micro-benchmark) so it fails loudly if the complexity class
  // regresses, without being flaky on ordinary CI variance.
  it('stays fast on the adversarial many-unclosed-fence-markers shape (construction proof, not an assumption)', () => {
    const adversarial = '```\n'.repeat(50_000)
    const start = performance.now()
    maskFencedCode(adversarial)
    const elapsedMs = performance.now() - start
    expect(elapsedMs).toBeLessThan(1000)
  })
})
