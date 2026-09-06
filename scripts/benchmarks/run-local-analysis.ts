import { constants } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { acknowledgeLocalTimeout } from '../../lib/local-qualification/local-transport'
import { acknowledgeLocalStageTimeout, STAGES, type StageID } from '../../lib/local-qualification/stages'
import { createStageStore, createLocalTransportStore, createArtifactStore } from '../../lib/local-qualification/stage-store'
import { open } from 'node:fs/promises'
import { runAuthorizedLocalIsolatedAnalysis } from '../../lib/local-qualification/analysis'
import { prepareLocalAnalysis } from '../../lib/local-qualification/local-analysis-options'
import { digest, PRIVATE_ROOT } from '../../lib/local-qualification/manifests'
import { createSource } from '../../lib/local-qualification/source'

const INPUT_HASH = '36ad4bcccad2ec7392e91998046b6e70c14ae9749e430a8ab5284ca64ab6c779'
export async function main(args: string[] = process.argv.slice(2)) {
  const [mode, ...pins] = args
  const hash = (s: string) => /^[a-f0-9]{64}$/.test(s)
  const index = (s: string) => /^(0|[1-9][0-9]{0,3})$/.test(s) && Number(s) < 4096
  const operator = (s: string) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(s)
  const basic = ['--preflight', '--run'].includes(mode) && pins.length === 0
  const transportAck = mode === '--acknowledge-transport' && pins.length === 3 && index(pins[0]) && hash(pins[1]) && operator(pins[2])
  const stageAck = mode === '--recover-stage' && pins.length === 8 && hash(pins[0]) && STAGES.some(s => s.id === pins[1]) &&
    index(pins[2]) && index(pins[3]) && hash(pins[4]) && hash(pins[5]) && operator(pins[6]) && ['legacy-55s-60s', 'transport180s-stage240s'].includes(pins[7])
  if (!basic && !transportAck && !stageAck) throw new Error('ARGUMENTS_INVALID')
  process.umask(0o077)
  if (transportAck) {
    await acknowledgeLocalTimeout({ stageStore: createLocalTransportStore(), artifactStore: createArtifactStore(), index: Number(pins[0]), expectedResultHash: pins[1], operator: pins[2] })
    console.log(JSON.stringify({ status: 'transport-acknowledgment-recorded-not-executed' }))
    return
  }
  const path = new URL(`../../tmp/local-qualification/direct-p5-inputs/${INPUT_HASH}.json`, import.meta.url)
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  let bytes: Buffer
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 8_388_608) throw new Error('INPUT_INVALID')
    bytes = await handle.readFile()
  } finally { await handle.close() }
  if (digest(bytes) !== INPUT_HASH) throw new Error('INPUT_CHANGED')
  const data = JSON.parse(bytes.toString('utf8')) as { cases: { protocolText: string }[] }
  if (!Array.isArray(data.cases) || data.cases.length !== 1 || typeof data.cases[0].protocolText !== 'string') throw new Error('INPUT_INVALID')
  const source = createSource(data.cases[0].protocolText)
  if (stageAck) {
    const { options: analysis } = prepareLocalAnalysis(source, 'recovery-contract-reconstruction', pins[7] as 'legacy-55s-60s' | 'transport180s-stage240s')
    await acknowledgeLocalStageTimeout({ stageStore: createStageStore(), transportStore: createLocalTransportStore(), artifactStore: createArtifactStore(), analysis,
      runId: pins[0], stage: pins[1] as StageID, fenceIndex: Number(pins[2]), transportIndex: Number(pins[3]), expectedStageResultHash: pins[4], expectedTransportResultHash: pins[5], operator: pins[6] })
    console.log(JSON.stringify({ status: 'stage-recovery-recorded-not-executed', originalsPreserved: true }))
    return
  }
  const { options, authorization } = prepareLocalAnalysis(source, 'local-full-source-20260906-v2')
  if (mode === '--preflight') {
    console.log(JSON.stringify({ status: 'prepared-not-executed', sourceHash: source.id, sourceBytes: source.bytes.length,
      contractRoles: Object.keys(authorization.roleContracts), models: [options.extraction.model, options.inventory.model],
      transportTimeoutMs: options.localTransportTimeoutMs, stageTimeoutMs: options.timeoutMs, executionContract: options.extraction.id,
      suppliedEvidence: false, scientificAcceptance: 'unverified' }))
    return
  }
  const result = await runAuthorizedLocalIsolatedAnalysis(options, authorization)
  console.log(JSON.stringify({ runId: result.runId, artifactHash: result.artifactHash, artifactRoot: PRIVATE_ROOT,
    stages: result.stages.map(s => ({ stage: s.stage, status: s.status, code: s.code })),
    applied: false, ready: false, scientificAcceptance: 'unverified', localApiChargeUsd: 0 }))
  if (result.stages.some(s => s.status === 'failed')) process.exitCode = 1
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main().catch(() => { console.error('LOCAL_ANALYSIS_FAILED: private artifacts retained; no automatic retry'); process.exitCode = 1 })
