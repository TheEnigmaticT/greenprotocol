import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { mkdir, mkdtemp, open, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { OllamaDecomposedProvider, OLLAMA_PILOT_MODELS } from '../../lib/decomposed-benchmark/ollama-provider'
import { runLocalP5Session } from '../../lib/decomposed-benchmark/local-session'
import type { DecomposedPilotCase } from '../../lib/decomposed-benchmark/pilot'

// One existing historical input, not a claim of complete cohort acquisition.
const INPUTS = {
  '--run': 'e04ad30551a53a2d9dc6221174012656498ce796aa3e7ef0be64d6ba99b92d2c',
  '--run-small': '36ad4bcccad2ec7392e91998046b6e70c14ae9749e430a8ab5284ca64ab6c779',
} as const
const ROOT = new URL('../../tmp/local-qualification/', import.meta.url)
const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex')
async function main() {
  process.umask(0o077)
  const mode = process.argv[2]
  if (process.argv.length !== 3 || !['--smoke', ...Object.keys(INPUTS)].includes(mode)) throw new Error('INVALID_ARGUMENTS')
  const parent = new URL('direct-p5-runs/', ROOT)
  await mkdir(parent, { recursive: true, mode: 0o700 })
  const run = await mkdtemp(fileURLToPath(parent) + 'run-')
  let sequence = 0
  async function persist(event: Record<string, unknown>) {
    const path = `${run}/${String(++sequence).padStart(3, '0')}.json`
    const bytes = Buffer.from(JSON.stringify(event, null, 2) + '\n')
    const handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600)
    try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
    if (!(await readFile(path)).equals(bytes)) throw new Error('ARTIFACT_READBACK_FAILED')
  }
  const provider = new OllamaDecomposedProvider()
  if (mode === '--smoke') {
    for (const model of OLLAMA_PILOT_MODELS) {
      const request = { model, stage: 'smoke', system: 'Return only the requested JSON object.', user: 'Set ok to true.', schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false } }
      await persist({ kind: 'request', request })
      try {
        const response = await provider.completeJson<{ ok: boolean }>(request)
        await persist({ kind: 'response', response, rawResponse: response.rawResponse })
        if (response.data.ok !== true) throw new Error('SMOKE_INVALID')
        console.log(JSON.stringify({ stage: 'smoke', model, status: 'passed', latencyMs: response.latencyMs, usage: response.usage, localApiChargeUsd: 0 }))
      } catch (error) {
        await persist({ kind: 'failure', error: error instanceof Error ? error.message : 'FAILED', rawResponse: error instanceof Error && 'rawResponse' in error ? error.rawResponse : null })
        throw error
      }
    }
    console.log(JSON.stringify({ status: 'smoke-completed', artifactDirectory: run }))
    return
  }
  const inputHash = INPUTS[mode as keyof typeof INPUTS]
  const handle = await open(new URL(`direct-p5-inputs/${inputHash}.json`, ROOT), constants.O_RDONLY | constants.O_NOFOLLOW)
  let raw: Buffer
  try {
    const before = await handle.stat()
    if (!before.isFile() || before.nlink !== 1 || before.size > 8_388_608) throw new Error('INPUT_INVALID')
    raw = await handle.readFile()
  } finally { await handle.close() }
  if (hash(raw) !== inputHash) throw new Error('INPUT_CHANGED')
  const data = JSON.parse(raw.toString('utf8')) as { cases: DecomposedPilotCase[] }
  if (!Array.isArray(data.cases) || data.cases.length !== 1) throw new Error('INPUT_INVALID')
  const fixture = data.cases[0]
  if (typeof fixture.protocolText !== 'string' || !Array.isArray(fixture.eligibility) || !fixture.eligibility.length || fixture.eligibility.some(c => c.principleNumber !== 5)) throw new Error('INPUT_INVALID')
  await persist({ kind: 'input', sourceArtifactHash: inputHash, sourceHash: hash(fixture.protocolText), fixture,
    limitations: ['historical supplied evidence not newly literature-verified', 'candidate-scoped extraction, not full-protocol completeness', 'experimental proposal only; no source or application write'] })
  const outcome = await runLocalP5Session({ fixture, workerModel: OLLAMA_PILOT_MODELS[0], auditorModel: OLLAMA_PILOT_MODELS[1], provider, persist })
  const report = [
    '# Local P5 experiment — not scientifically approved',
    `Status: ${outcome.status}. Applied to source/application: no.`,
    `Model calls: ${outcome.attempts}. Elapsed milliseconds: ${outcome.latencyMs}.`,
    'Scope: one historical input; candidate-scoped extraction; supplied evidence not independently literature-verified. No full-protocol or quality-parity claim.',
    '', '## Decisions',
    ...(outcome.result?.decisions.map(d => `- Span ${d.stepNumber}: ${d.material} → ${d.alternative ?? '(no alternative)'} — ${d.status}\n  ${d.reason}\n  Supplied excerpts: ${d.evidence.length}`) ?? ['Run failed. Inspect the preserved request/failure records.']),
    '', '## Original protocol (authoritative)', '', fixture.protocolText,
    '', '## Proposed protocol (unapplied)', '', outcome.result?.finalProtocol ?? 'Unavailable: run failed.',
  ].join('\n') + '\n'
  const reportPath = `${run}/report.md`
  const reportHandle = await open(reportPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600)
  try { await reportHandle.writeFile(report); await reportHandle.sync() } finally { await reportHandle.close() }
  if ((await readFile(reportPath, 'utf8')) !== report) throw new Error('REPORT_READBACK_FAILED')
  console.log(JSON.stringify({ status: outcome.status, attempts: outcome.attempts, latencyMs: outcome.latencyMs,
    proposedChanges: outcome.result?.changeCards.length ?? 0, sourcePreserved: outcome.result ? outcome.result.finalProtocol === fixture.protocolText : null,
    decisions: outcome.result?.decisions.map(d => ({ status: d.status, evidenceCount: d.evidence.length })) ?? [],
    applied: false, scientificAcceptance: 'unverified', artifactDirectory: run, reportPath }))
  if (outcome.status !== 'completed') process.exitCode = 1
}
void main().catch(() => { console.error('LOCAL_P5_FAILED: inspect private artifacts; no automatic retry'); process.exitCode = 1 })
