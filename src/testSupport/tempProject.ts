// Test-only helper (excluded from the published build — see
// tsconfig.build.json) for integration tests that need a real, disposable
// directory tree on disk — not the in-memory DocsFs double. Its main reason
// to exist: modelling BEFORE/AFTER drift. A doc's links are correct when
// authored; real drift (a target renamed, a heading reworded, a file
// shrunk) happens later, and `cairn check` catching that later change —
// with a meaningful error, not a crash — is the property worth proving.
// `write` doubles as the "AFTER" mutation: call it again, post-assertion,
// to overwrite a file the same way a later commit would.

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

export interface TempProject {
  readonly root: string
  /** Write (or overwrite) a file at `relPath` (relative to `root`), creating parent directories as needed. */
  readonly write: (relPath: string, content: string) => void
  /** Remove the whole temp directory tree. Safe to call once, typically in `afterAll`/a `finally` block. */
  readonly dispose: () => void
}

/** A fresh temp directory under `os.tmpdir()`, seeded with `files` (relPath -> content). */
export const makeTempProject = (prefix: string, files: Record<string, string> = {}): TempProject => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`))

  const write = (relPath: string, content: string): void => {
    const abs = path.join(root, relPath)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, content)
  }

  for (const [relPath, content] of Object.entries(files)) {
    write(relPath, content)
  }

  return {
    dispose: () => fs.rmSync(root, { force: true, recursive: true }),
    root,
    write,
  }
}
