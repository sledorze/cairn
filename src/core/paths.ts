// Path normalisation. The pure planners reason in POSIX (`/`) paths so behaviour
// is identical on every OS; the IO layer normalises real filesystem paths (which
// may use `\` on Windows) to POSIX before they reach the core.

/** Convert an OS path to POSIX form (`\` -> `/`). */
export const toPosix = (p: string): string => p.replaceAll('\\', '/')
