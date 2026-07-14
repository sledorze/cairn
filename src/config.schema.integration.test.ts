import * as fs from 'node:fs'
import * as path from 'node:path'

import { describe, expect, it } from 'vitest'

import { generateSchema } from '../scripts/generate-schema.ts'

// `schema/cairn.schema.json` is generated from `CairnConfigSchema` (see
// scripts/generate-schema.ts) so the shipped `$schema` can never silently drift from the
// runtime decoder it documents. This test is the enforcement: run `pnpm run
// generate-schema` and commit the result if it fails.
const schemaFile = path.resolve(import.meta.dirname, '../schema/cairn.schema.json')

describe('schema/cairn.schema.json', () => {
  it('matches what CairnConfigSchema currently generates', () => {
    const committed = JSON.parse(fs.readFileSync(schemaFile, 'utf8')) as unknown
    expect(committed).toEqual(generateSchema())
  })
})
