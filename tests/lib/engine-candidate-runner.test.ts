import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AnalysisResult, ProgressEvent } from '../../lib/types'

const { analyzeProtocol } = vi.hoisted(() => ({ analyzeProtocol: vi.fn() }))

vi.mock('../../lib/pipeline', () => ({ analyzeProtocol }))

import {
  isAllowedCandidateRequest,
  parseArguments,
  parseCandidateRunConfig,
  run,
  sanitizeReceiptValue,
} from '../../scripts/run-engine-candidate'

const MODEL_BASE_URL = 'https://openrouter.ai/api/v1'
const EMBEDDING_BASE_URL = 'https://embedding.example.test/v1'
const EVIDENCE_RPC_URL = 'https://evidence.example.test/rest/v1/rpc/match_literature_evidence_units'
const CANDIDATE_ENV_NAMES = [
  'GCAI_ENGINE_CANDIDATE',
  'GCAI_LLM_BASE_URL',
  'GCAI_LLM_MODEL',
  'GCAI_LLM_API_KEY',
  'OPENROUTER_API_KEY',
  'GCAI_EMBEDDING_BASE_URL',
  'GCAI_EMBEDDING_MODEL',
  'GCAI_EMBEDDING_API_KEY',
  'GCAI_PUBLIC_EVIDENCE_RPC_URL',
  'GCAI_PUBLIC_EVIDENCE_RPC_KEY',
  'CHEMISTRY_SERVICE_TOKEN',
  'CHEMISTRY_SERVICE_URL',
] as const

const originalArgv = [...process.argv]
const originalEnvironment = Object.fromEntries(CANDIDATE_ENV_NAMES.map(name => [name, process.env[name]]))

afterEach(() => {
  process.argv = [...originalArgv]
  for (const name of CANDIDATE_ENV_NAMES) {
    const value = originalEnvironment[name]
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  analyzeProtocol.mockReset()
  vi.restoreAllMocks()
})

function configuredEnv(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    GCAI_ENGINE_CANDIDATE: '1',
    GCAI_LLM_BASE_URL: MODEL_BASE_URL,
    GCAI_LLM_MODEL: 'qwen/qwen3.8-27b',
    OPENROUTER_API_KEY: 'router-secret',
    GCAI_EMBEDDING_BASE_URL: EMBEDDING_BASE_URL,
    GCAI_EMBEDDING_MODEL: 'text-embedding-3-small',
    GCAI_EMBEDDING_API_KEY: 'embedding-secret',
    GCAI_PUBLIC_EVIDENCE_RPC_URL: EVIDENCE_RPC_URL,
    GCAI_PUBLIC_EVIDENCE_RPC_KEY: 'public-evidence-key',
    CHEMISTRY_SERVICE_TOKEN: 'chemistry-secret',
    ...overrides,
  }
}

describe('engine candidate runner guards', () => {
  it('requires exactly one explicit input source and validates option values', () => {
    expect(() => parseArguments(['--case', 'fixture-1', '--protocol-file', '/tmp/protocol.txt', '--preflight']))
      .toThrow('--case and --protocol-file are mutually exclusive')
    expect(() => parseArguments(['--protocol-file']))
      .toThrow('--protocol-file requires a value')
    expect(() => parseArguments(['--case', 'fixture-1', '--output']))
      .toThrow('--output requires a value')
    expect(() => parseArguments(['--case', 'fixture-1']))
      .toThrow('--output is required unless --preflight is used')
    expect(() => parseArguments(['--preflight']))
      .toThrow('Exactly one of --case or --protocol-file is required')

    expect(parseArguments(['--protocol-file', '/tmp/protocol.txt', '--preflight'])).toMatchObject({
      protocolFile: '/tmp/protocol.txt',
      preflight: true,
    })
  })

  it('permits only the configured model, embedding, public evidence RPC, and loopback chemistry routes', () => {
    const config = parseCandidateRunConfig(configuredEnv())

    expect(isAllowedCandidateRequest(config, {
      url: 'https://openrouter.ai/api/v1/chat/completions',
      method: 'POST',
      body: { model: 'qwen/qwen3.8-27b' },
    })).toBe(true)
    expect(isAllowedCandidateRequest(config, {
      url: 'https://embedding.example.test/v1/embeddings',
      method: 'POST',
      body: { model: 'text-embedding-3-small' },
    })).toBe(true)
    expect(isAllowedCandidateRequest(config, {
      url: EVIDENCE_RPC_URL,
      method: 'POST',
      body: { requested_visibility: 'public' },
    })).toBe(true)
    expect(isAllowedCandidateRequest(config, {
      url: 'http://127.0.0.1:8007/health',
      method: 'GET',
    })).toBe(true)
    expect(isAllowedCandidateRequest(config, {
      url: 'http://127.0.0.1:8007/batch',
      method: 'POST',
      body: {},
    })).toBe(true)
    expect(isAllowedCandidateRequest(config, {
      url: 'http://127.0.0.1:8007/score',
      method: 'POST',
      body: {},
    })).toBe(true)

    expect(isAllowedCandidateRequest(config, {
      url: 'https://openrouter.ai/api/v1/chat/completions',
      method: 'POST',
      body: { model: 'other/model' },
    })).toBe(false)
    expect(isAllowedCandidateRequest(config, {
      url: 'https://embedding.example.test/v1/embeddings',
      method: 'POST',
      body: { model: 'other-embedding' },
    })).toBe(false)
    expect(isAllowedCandidateRequest(config, {
      url: EVIDENCE_RPC_URL,
      method: 'POST',
      body: { requested_visibility: 'private' },
    })).toBe(false)
    expect(isAllowedCandidateRequest(config, {
      url: 'https://api.anthropic.com/v1/messages',
      method: 'POST',
      body: {},
    })).toBe(false)
    expect(isAllowedCandidateRequest(config, {
      url: 'http://127.0.0.1:8007/assistant-tools',
      method: 'POST',
      body: {},
    })).toBe(false)
  })

  it('requires explicit candidate settings and permits OpenRouter fallback only at the exact OpenRouter v1 endpoint', () => {
    expect(() => parseCandidateRunConfig(configuredEnv({ GCAI_ENGINE_CANDIDATE: '0' })))
      .toThrow('GCAI_ENGINE_CANDIDATE=1 is required')
    expect(() => parseCandidateRunConfig(configuredEnv({ GCAI_LLM_BASE_URL: 'https://router.example.test/v1', GCAI_LLM_API_KEY: '' })))
      .toThrow('GCAI_LLM_API_KEY is required for a non-OpenRouter candidate endpoint')

    const config = parseCandidateRunConfig(configuredEnv({
      GCAI_PUBLIC_EVIDENCE_RPC_URL: '',
      GCAI_PUBLIC_EVIDENCE_RPC_KEY: '',
      GCAI_EMBEDDING_BASE_URL: '',
      GCAI_EMBEDDING_MODEL: '',
      GCAI_EMBEDDING_API_KEY: '',
    }))
    expect(config.research.status).toBe('unavailable')
    expect(config.model.apiKeySource).toBe('openrouter-fallback')
  })

  it('redacts credential-shaped fields and known runtime credential values from receipts', () => {
    const sanitized = sanitizeReceiptValue({
      authorization: 'Bearer router-secret',
      nested: {
        api_key: 'embedding-secret',
        chemistry_service_token: 'chemistry-secret',
        safe: 'router-secret appears in diagnostic text',
      },
      response: 'Authorization: Bearer router-secret',
    }, ['router-secret', 'embedding-secret', 'chemistry-secret'])

    expect(sanitized).toEqual({
      authorization: '[REDACTED]',
      nested: {
        api_key: '[REDACTED]',
        chemistry_service_token: '[REDACTED]',
        safe: '[REDACTED] appears in diagnostic text',
      },
      response: `Authorization: Bearer ${['[', 'REDACTED', ']'].join('')}`,
    })
  })

  it('runs a protocol file through the existing pipeline and reports degraded completion truthfully', async () => {
    const root = mkdtempSync(join(tmpdir(), 'engine-candidate-runner-'))
    const protocolFile = join(root, 'protocol.txt')
    const output = join(root, 'output')
    const protocolText = 'Add water, stir for 10 minutes, then isolate the product.\n'
    writeFileSync(protocolFile, protocolText)

    for (const name of CANDIDATE_ENV_NAMES) delete process.env[name]
    Object.assign(process.env, {
      GCAI_ENGINE_CANDIDATE: '1',
      GCAI_LLM_BASE_URL: MODEL_BASE_URL,
      GCAI_LLM_MODEL: 'qwen/qwen3.8-27b',
      OPENROUTER_API_KEY: 'router-secret',
      CHEMISTRY_SERVICE_TOKEN: 'chemistry-secret',
    })
    process.argv = ['node', 'scripts/run-engine-candidate.ts', '--protocol-file', protocolFile, '--output', output]
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('raw failed model output', {
      status: 502,
      headers: { 'content-type': 'text/plain' },
    }))

    analyzeProtocol.mockImplementation(async (text: string, onProgress?: (event: ProgressEvent) => void): Promise<AnalysisResult> => {
      await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify({ model: 'qwen/qwen3.8-27b' }),
      })
      for (let number = 1; number <= 12; number += 1) {
        onProgress?.({
          type: 'principle',
          number,
          name: `Principle ${number}`,
          status: number === 7 ? 'failed' : 'complete',
          ...(number === 7 ? {} : { recommendations: 0 }),
        })
      }
      return {
        protocolTitle: 'Protocol file test',
        chemistrySubdomain: 'general',
        steps: [],
        recommendations: [],
        revisedProtocol: '',
        overallAssessment: {
          greenPrinciplesViolated: [],
          mostImpactfulChange: 'None',
          experimentalValidationNeeded: true,
          disclaimer: 'Test only',
        },
        chemistryDataStatus: {
          pending: true,
          deterministicScoringAvailable: false,
          unresolvedChemicals: [],
          message: 'Unavailable in test',
        },
      }
    })

    try {
      await run()
      expect(analyzeProtocol).toHaveBeenCalledWith(protocolText, expect.any(Function))

      const manifest = JSON.parse(readFileSync(join(output, 'manifest.json'), 'utf8'))
      expect(manifest.caseId).toBe('protocol-file')
      expect(manifest.protocolSha256).toBe(createHash('sha256').update(protocolText).digest('hex'))

      const summary = JSON.parse(readFileSync(join(output, 'summary.json'), 'utf8'))
      expect(summary).toMatchObject({
        ok: false,
        caseId: 'protocol-file',
        revisedProtocolPresent: false,
        pipelineRuntime: { status: 'degraded' },
      })
      expect(summary.principleOutcomes).toHaveLength(12)
      expect(summary.principleOutcomes.find((outcome: { principle: number }) => outcome.principle === 7))
        .toMatchObject({ status: 'failed' })
      expect(readFileSync(join(output, 'call-001.json'), 'utf8')).toContain('raw failed model output')
      expect(readFileSync(join(output, 'result.json'), 'utf8')).toContain('"revisedProtocol": ""')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
