import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { AnthropicDecomposedProvider } from '@/lib/decomposed-benchmark/anthropic-provider'
import { OpenRouterDecomposedProvider } from '@/lib/decomposed-benchmark/openrouter-provider'
import { runDecomposedPilot, type DecomposedPilotCase } from '@/lib/decomposed-benchmark/pilot'

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function validCase(value: unknown): value is DecomposedPilotCase {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  return typeof item.caseId === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/i.test(item.caseId) && typeof item.protocolText === 'string' && Array.isArray(item.eligibility) && Boolean(item.evidenceByAlternative) && typeof item.evidenceByAlternative === 'object' && !Array.isArray(item.evidenceByAlternative)
}

async function main(): Promise<void> {
  const inputPath = arg('--input')
  const model = arg('--model')
  const providerName = arg('--provider')
  if (!inputPath || !model || (providerName !== 'openrouter' && providerName !== 'anthropic')) {
    throw new Error('Usage: --input local-pilot.json --provider openrouter|anthropic --model exact-model-id')
  }
  const parsed = JSON.parse(await readFile(resolve(inputPath), 'utf8')) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !Array.isArray((parsed as { cases?: unknown }).cases) || !(parsed as { cases: unknown[] }).cases.every(validCase)) {
    throw new Error('Pilot input must be an object with a valid cases array')
  }
  const provider = providerName === 'openrouter'
    ? new OpenRouterDecomposedProvider({ apiKey: process.env.OPENROUTER_API_KEY ?? '' })
    : new AnthropicDecomposedProvider()
  const result = await runDecomposedPilot({ cases: (parsed as { cases: DecomposedPilotCase[] }).cases, model, provider })
  const outputDir = resolve('tmp/decomposed-benchmarks')
  await mkdir(outputDir, { recursive: true })
  const outputPath = resolve(outputDir, `${basename(inputPath, '.json')}-${model.replace(/[^a-z0-9._-]/gi, '_')}.json`)
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  process.stdout.write(`${outputPath}\n`)
}

void main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Decomposed benchmark failed'}\n`)
  process.exitCode = 1
})
