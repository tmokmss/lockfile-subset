import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import yaml from 'js-yaml'
import type { ExtractResult } from './extract.js'
import type { PnpmExtractResult } from './extract-pnpm.js'
import type { YarnExtractResult } from './extract-yarn.js'

export type AnyExtractResult = ExtractResult | PnpmExtractResult | YarnExtractResult

export function writeOutput(outputDir: string, result: AnyExtractResult): void {
  mkdirSync(outputDir, { recursive: true })

  writeFileSync(
    join(outputDir, 'package.json'),
    JSON.stringify(result.packageJson, null, 2) + '\n',
  )

  if (result.type === 'npm') {
    writeFileSync(
      join(outputDir, 'package-lock.json'),
      JSON.stringify(result.lockfileJson, null, 2) + '\n',
    )
  } else if (result.type === 'pnpm') {
    writeFileSync(
      join(outputDir, 'pnpm-lock.yaml'),
      yaml.dump(result.lockfileYaml, {
        lineWidth: -1,
        noCompatMode: true,
        quotingType: "'",
        forceQuotes: false,
      }),
    )
  } else {
    writeFileSync(join(outputDir, 'yarn.lock'), result.lockfileContent)
  }
}
