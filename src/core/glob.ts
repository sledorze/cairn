// Tiny dependency-free glob matcher for `ignore` patterns and `roots` expansion.
// Supports `**` (any run, including `/`), `*` (any run except `/`) and `?` (one
// char except `/`). Patterns and paths use `/` separators. Pure and unit-tested.

const SPECIAL = /[.+^${}()|[\]\\]/g

// Ignore/root pattern lists are small and reused across every path they're tested
// against (an O(paths) x O(patterns) product), so compiling once per distinct
// pattern — instead of once per call — turns that product into O(patterns).
const compiled = new Map<string, RegExp>()

/** Compile a glob into an anchored RegExp. */
export const globToRegExp = (pattern: string): RegExp => {
  const cached = compiled.get(pattern)
  if (cached) {
    return cached
  }
  const re = compile(pattern)
  compiled.set(pattern, re)
  return re
}

const compile = (pattern: string): RegExp => {
  let re = ''
  for (let i = 0; i < pattern.length; i += 1) {
    const c = pattern[i]
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        // `**` — any run including path separators. Absorb a following `/`.
        i += 1
        if (pattern[i + 1] === '/') {
          i += 1
          re += '(?:.*/)?'
        } else {
          re += '.*'
        }
      } else {
        re += '[^/]*'
      }
    } else if (c === '?') {
      re += '[^/]'
    } else {
      re += (c ?? '').replace(SPECIAL, '\\$&')
    }
  }
  return new RegExp(`^${re}$`)
}

/** True when `path` matches the glob `pattern`. */
export const matchesGlob = (path: string, pattern: string): boolean => globToRegExp(pattern).test(path)

/** True when `path` matches any of the glob `patterns`. */
export const matchesAny = (path: string, patterns: readonly string[]): boolean =>
  patterns.some((pattern) => matchesGlob(path, pattern))
