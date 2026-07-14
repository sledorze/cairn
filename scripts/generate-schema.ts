// Regenerates `schema/cairn.schema.json` from `CairnConfigSchema` (src/core/Config.ts),
// the single source of truth for the config's TS type, runtime decode, AND this file. Run
// via `pnpm run generate-schema`; wired into `pnpm build` so the committed file can never
// silently drift from the schema it's generated from (checked by
// src/config.schema.integration.test.ts, which fails CI if they differ).

import * as fs from 'node:fs'
import * as path from 'node:path'

import { Console, Effect, JSONSchema } from 'effect'
import * as prettier from 'prettier'

import { CairnConfigSchema } from '../src/core/Config.ts'

const outFile = path.resolve(import.meta.dirname, '../schema/cairn.schema.json')

export const generateSchema = (): unknown => JSONSchema.make(CairnConfigSchema)

/** Format like the rest of the repo (`.prettierrc`) so the committed file never needs a
 * separate `pnpm format` pass and always matches what `pnpm format:check` expects. */
const formatSchema = async (schema: unknown): Promise<string> => {
  const config = await prettier.resolveConfig(outFile)
  return prettier.format(JSON.stringify(schema), { ...config, filepath: outFile })
}

if (process.argv[1] === import.meta.filename) {
  const formatted = await formatSchema(generateSchema())
  fs.writeFileSync(outFile, formatted)
  const relativeOutFile = path.relative(process.cwd(), outFile)
  Effect.runSync(Console.log(`cairn: wrote ${relativeOutFile}`))
}
