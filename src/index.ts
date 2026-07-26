// Public API surface. The CLI (`cairn`) is the primary entrypoint, but the pure
// planners and Effect programs are exported for programmatic use and testing.

export * from './core/summaries/DocSummaries.ts'
export * from './core/glob.ts'
export * from './core/links/MarkdownLinks.ts'
export * from './core/summaries/SummaryTree.ts'
export * from './io/DocsFs.ts'
export * from './program/links/CheckLinks.ts'
export * from './program/summaries/CheckSummaries.ts'
export * from './program/locale.ts'
export * from './config.ts'
export type { AgentTarget, InitArgs, InitResult } from './init/generate.ts'
export { runInit } from './init/generate.ts'
