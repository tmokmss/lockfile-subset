import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import type { ExtractResult } from './extract.js'

export function writeOutput(outputDir: string, result: ExtractResult): void {
  mkdirSync(outputDir, { recursive: true })

  writeFileSync(
    join(outputDir, 'package.json'),
    JSON.stringify(result.packageJson, null, 2) + '\n',
  )

  writeFileSync(
    join(outputDir, 'package-lock.json'),
    JSON.stringify(result.lockfileJson, null, 2) + '\n',
  )
}
