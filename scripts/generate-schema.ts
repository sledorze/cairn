// Regenerates `schema/cairn.schema.json` from `CairnConfigSchema` (src/core/Config.ts),
// the single source of truth for the config's TS type, runtime decode, AND this file. Run
// via `pnpm run generate-schema`; wired into `pnpm build` so the committed file can never
// silently drift from the schema it's generated from (checked by
// src/config.schema.integration.test.ts, which fails CI if they differ).

import * as fs from 'node:fs'
import * as path from 'node:path'

import { Console, Effect, JsonSchema, Schema } from 'effect'
import * as prettier from 'prettier'

import { CairnConfigSchema } from '../src/core/Config.ts'

const outFile = path.resolve(import.meta.dirname, '../schema/cairn.schema.json')

/** `Schema.toJsonSchemaDocument` emits draft-2020-12 with defs under `definitions` and
 * `$ref`s pointing at `#/definitions/...`. Editors/IDEs expect the flatter, `$defs`-based
 * shape this repo has always shipped, so convert to draft-07, flatten it into a single
 * object (draft-07's own shape keeps `definitions` inline as a root sibling), then run
 * it back through `JsonSchema.fromSchemaDraft07` — the library's own structured `$ref`
 * rewriter (`#/definitions/` -> `#/$defs/`) — instead of string-replacing the serialized
 * JSON, which would also mangle any legitimate description text containing that substring. */
export const generateSchema = (): unknown => {
  const document2020 = Schema.toJsonSchemaDocument(CairnConfigSchema)
  const document07 = JsonSchema.toDocumentDraft07(document2020)
  const { definitions, schema } = JsonSchema.fromSchemaDraft07({
    ...document07.schema,
    definitions: document07.definitions,
  })
  return {
    $defs: definitions,
    $schema: `${JsonSchema.META_SCHEMA_URI_DRAFT_07}#`,
    ...schema,
  }
}

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
