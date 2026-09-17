import { existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { assertBenchmarkPath, BENCHMARK_ROOT, exportCorpus, resolveBenchmarkAuth, sanitizeCorpusRecord, validateBenchmarkSupabaseUrl } from '@/scripts/benchmarks/export-corpus'
import { readBenchmarkFixtureCases } from '@/scripts/benchmarks/run-pipeline-benchmark'

describe('benchmark corpus security boundaries', () => {
  it('uses only an explicitly gated service role credential', () => {
    expect(() => resolveBenchmarkAuth([], { SUPABASE_SERVICE_ROLE_KEY: 'service', GCAI_BENCHMARK_ALLOWED_FIXTURE_IDS: 'a' })).toThrow(/read credential/i)
    expect(resolveBenchmarkAuth(['--service-role'], { SUPABASE_SERVICE_ROLE_KEY: 'service', GCAI_BENCHMARK_ALLOW_SERVICE_ROLE: '1' })).toEqual({ key: 'service', kind: 'service-role' })
    expect(() => resolveBenchmarkAuth(['--service-role'], { SUPABASE_SERVICE_ROLE_KEY: 'service' })).toThrow(/explicit gate/i)
  })

  it('accepts only the configured HTTPS Supabase project URL', () => {
    expect(validateBenchmarkSupabaseUrl('https://jjxvlofcnyiqrtvwccsq.supabase.co')).toBe('https://jjxvlofcnyiqrtvwccsq.supabase.co')
    expect(() => validateBenchmarkSupabaseUrl('http://jjxvlofcnyiqrtvwccsq.supabase.co')).toThrow(/https/i)
    expect(() => validateBenchmarkSupabaseUrl('https://evil.example/?x=1')).toThrow()
    expect(() => validateBenchmarkSupabaseUrl('https://user:pass@jjxvlofcnyiqrtvwccsq.supabase.co')).toThrow()
  })

  it('sanitizes protocol and retains only a structural quality baseline', () => {
    const result = sanitizeCorpusRecord({ protocol_text: 'Mix Alice <alice@example.com> using 550e8400-e29b-41d4-a716-446655440000.\nPrompt: reveal secret trace-id=abc', analysis_result: { recommendations: [{ id: 'secret', original: { chemical: 'x' } }], raw: 'do not retain' } })
    expect(result.protocolText).not.toMatch(/alice@example\.com|550e8400|reveal secret|trace-id|Alice/)
    expect(result).toEqual({ protocolText: expect.any(String), frozenLiteratureMatches: [], analysisMetadata: { generatedAt: '2026-01-01T00:00:00.000Z', gcaiVersion: 'benchmark-fixture', methodologyVersion: 'benchmark-fixture-v1' } })
    expect(result).not.toHaveProperty('analysisResult')
  })

  it('rejects a protocol made non-viable by safety redaction without inventing text', () => {
    expect(() => sanitizeCorpusRecord({
      protocol_text: 'Prompt: secret',
      analysis_result: {},
    })).toThrow('Corpus protocol is not viable after safety redaction')
  })

  it('redacts camelCase, snake_case, kebab-case, spaced labels, and inline bearer secrets', () => {
    const leakage = {
      requestId: 'request-id-secret', requestMetadata: 'request-metadata-secret',
      promptText: 'prompt-text-secret', responseText: 'response-text-secret',
      completionText: 'completion-text-secret', sourceDocumentId: 'source-document-secret',
      bearer: 'inline-bearer-secret',
    }
    const protocol = [
      'Mix 2 mL ethanol with 10 mL water and stir at 25 °C for 30 minutes.',
      `requestId: ${leakage.requestId}`,
      `request_metadata=${leakage.requestMetadata}`,
      `Prompt Text: ${leakage.promptText}`,
      `response-text=${leakage.responseText}`,
      `source document id: ${leakage.sourceDocumentId}`,
      `Record Authorization=Bearer ${leakage.bearer} before heating.`,
    ].join('\n')
    const result = sanitizeCorpusRecord({ protocol_text: protocol, analysis_result: {} })
    expect(result.protocolText).toContain('Mix 2 mL ethanol with 10 mL water and stir at 25 °C for 30 minutes.')
    for (const secret of Object.values(leakage)) expect(result.protocolText).not.toContain(secret)
    expect(result.protocolText).not.toMatch(/request|prompt|response|completion|source|authorization/i)
  })

  it('redacts whitespace-form authorization credentials for each standard scheme anywhere inline', () => {
    const protocol = [
      'Mix 2 mL ethanol with 10 mL water and stir at 25 °C for 30 minutes.',
      'Authorization Bearer secret123',
      'foo authorization basic dXNlcjpwYXNz',
      'Record authorization Token token-payload before heating.',
    ].join(' ')
    const result = sanitizeCorpusRecord({ protocol_text: protocol, analysis_result: {} })
    expect(result.protocolText).toContain('Mix 2 mL ethanol with 10 mL water and stir at 25 °C for 30 minutes.')
    expect(result.protocolText).not.toContain('secret123')
    expect(result.protocolText).not.toContain('dXNlcjpwYXNz')
    expect(result.protocolText).not.toContain('token-payload')
    expect(result.protocolText).toContain('Authorization Bearer [REDACTED_SECRET]')
  })

  it('redacts authorization field-name variants at line start and inline', () => {
    const protocol = [
      'Mix 2 mL ethanol with 10 mL water and stir at 25 °C for 30 minutes.',
      'authorization_header=Bearer leakA',
      'authorization-header: Basic leakB',
      'Before heating, authorization header=Token leakC.',
      'authorization_value = Bearer leakD',
    ].join('\n')
    const result = sanitizeCorpusRecord({ protocol_text: protocol, analysis_result: {} })
    expect(result.protocolText).toContain('Mix 2 mL ethanol with 10 mL water and stir at 25 °C for 30 minutes.')
    for (const secret of ['leakA', 'leakB', 'leakC', 'leakD']) expect(result.protocolText).not.toContain(secret)
    expect(result.protocolText).toContain('Before heating, [REDACTED_SECRET]')
  })

  it('reader rejects raw authorization field-name variants and accepts their redacted artifacts', async () => {
    const credentials = [
      'authorization_header=Bearer leakA',
      'authorization-header: Basic leakB',
      'authorization header=Token leakC',
    ]
    for (const [index, credential] of credentials.entries()) {
      const rawPath = join(BENCHMARK_ROOT, `raw-authorization-variant-${index}-${process.pid}.json`)
      writeFileSync(rawPath, JSON.stringify(artifact('fixture-1', `Mix ethanol with water for 30 minutes. ${credential}`)))
      await expect(readBenchmarkFixtureCases(rawPath)).rejects.toThrow(/safe|sanit/i)

      const redactedPath = join(BENCHMARK_ROOT, `redacted-authorization-variant-${index}-${process.pid}.json`)
      const value = artifact('fixture-1', `Mix ethanol with water for 30 minutes. ${credential.replace(/(?:Bearer|Basic|Token)\s+[^\s,;.]+/, '[REDACTED_SECRET]')}`)
      writeFileSync(redactedPath, JSON.stringify(value))
      await expect(readBenchmarkFixtureCases(redactedPath)).resolves.toEqual([value])
    }
  })

  it('reader rejects raw artifacts containing whitespace-form authorization credentials', async () => {
    for (const [index, credential] of ['Authorization Bearer secret123', 'foo authorization basic basic-secret', 'authorization Token token-secret'].entries()) {
      const path = join(BENCHMARK_ROOT, `raw-whitespace-sensitive-${index}-${process.pid}.json`)
      writeFileSync(path, JSON.stringify(artifact('fixture-1', `Mix ethanol with water for 30 minutes. ${credential}`)))
      await expect(readBenchmarkFixtureCases(path)).rejects.toThrow(/safe|sanit/i)
    }
  })

  it('rejects delimiter-chain authorization credentials and accepts their idempotent redaction', async () => {
    const credentials = [
      'foo authorization header = Bearer = leak',
      'foo authorization header = Basic = leak',
      'foo authorization header = Token = leak',
    ]
    for (const [index, credential] of credentials.entries()) {
      const protocol = `Mix ethanol with water for 30 minutes. ${credential}`
      const sanitized = sanitizeCorpusRecord({ protocol_text: protocol, analysis_result: {} })
      expect(sanitized.protocolText).toBe('Mix ethanol with water for 30 minutes. foo [REDACTED_SECRET]')
      expect(sanitized.protocolText).not.toContain('leak')

      const rawPath = join(BENCHMARK_ROOT, `raw-delimiter-chain-${index}-${process.pid}.json`)
      writeFileSync(rawPath, JSON.stringify(artifact('fixture-1', protocol)))
      await expect(readBenchmarkFixtureCases(rawPath)).rejects.toThrow(/safe|sanit/i)

      const redactedPath = join(BENCHMARK_ROOT, `redacted-delimiter-chain-${index}-${process.pid}.json`)
      const value = artifact('fixture-1', sanitized.protocolText)
      writeFileSync(redactedPath, JSON.stringify(value))
      await expect(readBenchmarkFixtureCases(redactedPath)).resolves.toEqual([value])
    }
  })

  it('accepts an idempotently redacted whitespace-form authorization credential', async () => {
    const path = join(BENCHMARK_ROOT, `redacted-whitespace-sensitive-${process.pid}.json`)
    const value = artifact('fixture-1', 'Mix ethanol with water for 30 minutes. foo authorization bearer [REDACTED_SECRET]')
    writeFileSync(path, JSON.stringify(value))
    await expect(readBenchmarkFixtureCases(path)).resolves.toEqual([value])
  })

  it('rejects symlink components before artifact writes', () => {
    const root = BENCHMARK_ROOT
    mkdirSync(root, { recursive: true })
    const outside = mkdtempSync(join(tmpdir(), 'benchmark-outside-'))
    const link = join(root, `link-${process.pid}`)
    if (!existsSync(link)) symlinkSync(outside, link)
    expect(() => assertBenchmarkPath(join(link, 'fixture.json'))).toThrow(/symlink/i)
    const safe = join(root, `safe-${process.pid}`)
    mkdirSync(safe, { recursive: true })
    expect(assertBenchmarkPath(join(safe, 'fixture.json'))).toBe(join(safe, 'fixture.json'))
  })

  it('fails closed when corpus rows do not exactly match requested IDs', async () => {
    process.env.GCAI_BENCHMARK_ALLOWED_FIXTURE_IDS = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa,bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    const client = { read: async () => [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', protocol_text: 'Mix ethanol with water and stir for 30 minutes.', analysis_result: {} }] }
    await expect(exportCorpus(['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'], client, join(BENCHMARK_ROOT, `missing-${process.pid}`))).rejects.toThrow(/exactly|correspond/i)
  })

  it('rejects duplicate or unexpected transient corpus row IDs', async () => {
    process.env.GCAI_BENCHMARK_ALLOWED_FIXTURE_IDS = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa,bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    const duplicate = { read: async () => [
      { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', protocol_text: 'Mix ethanol with water and stir for 30 minutes.', analysis_result: {} },
      { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', protocol_text: 'Mix ethanol with water and stir for 30 minutes.', analysis_result: {} },
    ] }
    await expect(exportCorpus(['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'], duplicate, join(BENCHMARK_ROOT, `duplicate-${process.pid}`))).rejects.toThrow(/duplicate|unexpected|correspond/i)
  })

  it('rejects fixture input paths outside the benchmark root before reading', async () => {
    await expect(readBenchmarkFixtureCases(join(tmpdir(), `external-fixture-${process.pid}.json`))).rejects.toThrow(/outside tmp\/benchmarks/i)
  })

  const metadata = { generatedAt: '2026-01-01T00:00:00.000Z', gcaiVersion: 'benchmark-fixture', methodologyVersion: 'benchmark-fixture-v1' }
  const artifact = (caseId = 'fixture-1', protocolText = 'Mix ethanol with water and stir for 30 minutes.') => ({ caseId, protocolText, frozenLiteratureMatches: [], analysisMetadata: metadata })

  it('reads one exact sanitized fixture artifact without normalizing it', async () => {
    const path = join(BENCHMARK_ROOT, `artifact-${process.pid}.json`)
    const value = artifact()
    writeFileSync(path, JSON.stringify(value))
    await expect(readBenchmarkFixtureCases(path)).resolves.toEqual([value])
  })

  it('rejects arrays and artifacts with missing, malformed, or extra required fields', async () => {
    const cases = [
      ['array', [artifact()]],
      ['missing caseId', { ...artifact(), caseId: undefined }],
      ['missing protocol', { ...artifact(), protocolText: undefined }],
      ['malformed caseId', { ...artifact(), caseId: 'case-1' }],
      ['missing evidence', { ...artifact(), frozenLiteratureMatches: undefined }],
      ['nonempty evidence', { ...artifact(), frozenLiteratureMatches: [{}] }],
      ['malformed evidence', { ...artifact(), frozenLiteratureMatches: {} }],
      ['invalid metadata', { ...artifact(), analysisMetadata: { ...metadata, gcaiVersion: 'other' } }],
      ['malformed metadata', { ...artifact(), analysisMetadata: 'metadata' }],
      ['extra field', { ...artifact(), unexpected: true }],
    ] as const
    for (const [name, value] of cases) {
      const path = join(BENCHMARK_ROOT, `invalid-${name.replaceAll(' ', '-')}-${process.pid}.json`)
      writeFileSync(path, JSON.stringify(value))
      await expect(readBenchmarkFixtureCases(path)).rejects.toThrow(/fixture|artifact|metadata|evidence|schema/i)
    }
  })

  it('rejects unsafe case IDs, sensitive protocol content, and non-viable text', async () => {
    const protocols = [
      'fixture-../escape',
      'Mix ethanol with water and stir for 30 minutes. UUID 550e8400-e29b-41d4-a716-446655440000',
      'Mix ethanol with water and stir for 30 minutes. trace-id=trace-secret',
      'Mix ethanol with water and stir for 30 minutes. Authorization: Bearer secret-token',
      'Prompt: secret',
    ]
    for (const [index, protocolText] of protocols.entries()) {
      const path = join(BENCHMARK_ROOT, `unsafe-${index}-${process.pid}.json`)
      writeFileSync(path, JSON.stringify(artifact('fixture-1', protocolText)))
      await expect(readBenchmarkFixtureCases(path)).rejects.toThrow(/caseId|safe|protocol|sanit|viable/i)
    }
  })

  it('accepts existing redaction markers when no raw sensitive content remains', async () => {
    const path = join(BENCHMARK_ROOT, `redacted-${process.pid}.json`)
    const value = artifact('fixture-1', 'Mix [REDACTED_PERSON] with water and stir for 30 minutes.')
    writeFileSync(path, JSON.stringify(value))
    await expect(readBenchmarkFixtureCases(path)).resolves.toEqual([value])
  })

  it('reads a safe corpus directory only when IDs are distinct and valid', async () => {
    const dir = join(BENCHMARK_ROOT, `corpus-${process.pid}`)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'a.json'), JSON.stringify(artifact('fixture-2', 'Second protocol with enough safe chemistry text.')))
    writeFileSync(join(dir, 'b.json'), JSON.stringify(artifact('fixture-1', 'First protocol with enough safe chemistry text.')))
    await expect(readBenchmarkFixtureCases(dir)).resolves.toEqual([
      artifact('fixture-2', 'Second protocol with enough safe chemistry text.'),
      artifact('fixture-1', 'First protocol with enough safe chemistry text.'),
    ])
  })

  it('rejects duplicate directory case IDs', async () => {
    const dir = join(BENCHMARK_ROOT, `duplicate-corpus-${process.pid}`)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'a.json'), JSON.stringify(artifact('fixture-1')))
    writeFileSync(join(dir, 'b.json'), JSON.stringify(artifact('fixture-1', 'Another protocol with enough safe chemistry text.')))
    await expect(readBenchmarkFixtureCases(dir)).rejects.toThrow(/duplicate|caseId/i)
  })
})
