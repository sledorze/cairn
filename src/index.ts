// Public API surface. The CLI (`cairn`) is the primary entrypoint, but the pure
// planners and Effect programs are exported for programmatic use and testing.

export * from './core/DocSummaries.ts'
export * from './core/glob.ts'
export * from './core/MarkdownLinks.ts'
export * from './core/SummaryTree.ts'
export * from './io/DocsFs.ts'
export * from './program/CheckLinks.ts'
export * from './program/CheckSummaries.ts'
export * from './program/locale.ts'
export * from './config.ts'
export type { AgentTarget, InitArgs, InitResult } from './init/generate.ts'
export { runInit } from './init/generate.ts'
