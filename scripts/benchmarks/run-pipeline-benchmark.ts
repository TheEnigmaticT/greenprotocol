import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { AnthropicProvider } from '@/lib/benchmark/anthropic-provider'
import { OpenRouterProvider } from '@/lib/benchmark/openrouter-provider'
import { runFixtureBenchmark, sanitizeBenchmarkOutput } from '@/lib/benchmark/runner'
import type { BenchmarkFixtureCase } from '@/lib/benchmark/types'
import { assertBenchmarkPath, BENCHMARK_ROOT, validateSanitizedProtocol } from './export-corpus'

const SCRATCHFILE = '/Users/ct-mac-mini/Obsidian/CrowdTamers Obsidian Vault/Scratchfile.md'

export async function readAuthorizedOpenRouterKey(): Promise<string> {
  const content = await readFile(SCRATCHFILE, 'utf8')
  const match = content.match(/(?:OPENROUTER_API_KEY|OpenRouter API key)\s*[:=]\s*([^\s`]+)/i)
  if (!match?.[1]) throw new Error('Authorized OpenRouter key was not found in Scratchfile')
  return match[1]
}

export async function readBenchmarkFixtureCases(path: string): Promise<BenchmarkFixtureCase[]> {
  const fixturePath = assertBenchmarkPath(resolve(path))
  const info = await stat(fixturePath)
  const paths = info.isDirectory()
    ? (await readdir(fixturePath, { withFileTypes: true }))
      .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
      .map(entry => entry.name)
      .sort()
      .map(name => assertBenchmarkPath(resolve(fixturePath, name)))
    : [fixturePath]
  if (paths.length === 0) throw new Error('Benchmark fixture directory contains no JSON artifacts')
  const artifacts = await Promise.all(paths.map(async artifactPath => JSON.parse(await readFile(artifactPath, 'utf8')) as unknown))
  if (artifacts.some(Array.isArray)) throw new Error('Benchmark fixture artifact must be an object, not an array')
  const cases = artifacts.map(value => validateFixtureArtifact(value))
  const seen = new Set<string>()
  for (const fixtureCase of cases) {
    if (seen.has(fixtureCase.caseId)) throw new Error(`Duplicate benchmark fixture caseId: ${fixtureCase.caseId}`)
    seen.add(fixtureCase.caseId)
  }
  return cases
}

const FIXTURE_METADATA = { generatedAt: '2026-01-01T00:00:00.000Z', gcaiVersion: 'benchmark-fixture', methodologyVersion: 'benchmark-fixture-v1' } as const
const isSafeCaseId = (value: unknown): value is string => typeof value === 'string' && /^fixture-[1-9][0-9]*$/.test(value)

function validateFixtureArtifact(value: unknown): BenchmarkFixtureCase {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Benchmark fixture artifact must be an object')
  const artifact = value as Record<string, unknown>
  const keys = Object.keys(artifact).sort()
  if (keys.join('\0') !== ['analysisMetadata', 'caseId', 'frozenLiteratureMatches', 'protocolText'].join('\0')) throw new Error('Benchmark fixture artifact has an invalid schema')
  if (!isSafeCaseId(artifact.caseId)) throw new Error('Benchmark fixture caseId must be a safe fixture-N identifier')
  validateSanitizedProtocol(artifact.protocolText)
  if (!Array.isArray(artifact.frozenLiteratureMatches) || artifact.frozenLiteratureMatches.length !== 0) throw new Error('Benchmark fixture evidence must be an empty sanitized list')
  if (!artifact.analysisMetadata || typeof artifact.analysisMetadata !== 'object' || Array.isArray(artifact.analysisMetadata)) throw new Error('Benchmark fixture analysisMetadata is invalid')
  const metadata = artifact.analysisMetadata as Record<string, unknown>
  if (Object.keys(metadata).sort().join('\0') !== Object.keys(FIXTURE_METADATA).sort().join('\0') || Object.entries(FIXTURE_METADATA).some(([key, expected]) => metadata[key] !== expected)) throw new Error('Benchmark fixture analysisMetadata is not the public fixture metadata')
  return { caseId: artifact.caseId, protocolText: artifact.protocolText, frozenLiteratureMatches: [], analysisMetadata: FIXTURE_METADATA }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const fixturePath = args[args.indexOf('--fixture') + 1]
  const model = args[args.indexOf('--model') + 1]
  if (!fixturePath || !model || fixturePath.startsWith('-') || model.startsWith('-')) throw new Error('Usage: --fixture PATH --model MODEL')
  const cases = await readBenchmarkFixtureCases(fixturePath)
  const provider = model.startsWith('claude-')
    ? new AnthropicProvider()
    : new OpenRouterProvider({ apiKey: await readAuthorizedOpenRouterKey() })
  const output = sanitizeBenchmarkOutput(await runFixtureBenchmark({ cases, models: [{ model, provider }] }))
  const resultsDir = assertBenchmarkPath(resolve(BENCHMARK_ROOT, 'results'))
  await mkdir(resultsDir, { recursive: true })
  assertBenchmarkPath(resultsDir)
  const outputPath = assertBenchmarkPath(resolve(resultsDir, `${model.replace(/[^a-z0-9._-]/gi, '_')}.json`))
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, { encoding: 'utf8', flag: 'w' })
}

if (import.meta.url === `file://${process.argv[1]}`) void main().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : 'Benchmark failed'}\n`); process.exitCode = 1 })
