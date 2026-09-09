import { afterEach, describe, expect, it, vi } from 'vitest'
import { getChemistryServiceConfig } from '@/lib/chemistry-service-config'

describe('getChemistryServiceConfig', () => {
  it('rejects an empty chemistry URL instead of falling back to localhost', () => {
    expect(() => getChemistryServiceConfig({
      CHEMISTRY_SERVICE_URL: '',
      CHEMISTRY_SERVICE_TOKEN: 'service-token',
    })).toThrow('CHEMISTRY_SERVICE_URL is required')
  })

  it('rejects an empty chemistry token', () => {
    expect(() => getChemistryServiceConfig({
      CHEMISTRY_SERVICE_URL: 'https://chemistry.example.test',
      CHEMISTRY_SERVICE_TOKEN: '',
    })).toThrow('CHEMISTRY_SERVICE_TOKEN is required')
  })

  it('preserves a complete configured URL and token', () => {
    expect(getChemistryServiceConfig({
      CHEMISTRY_SERVICE_URL: 'https://chemistry.example.test/',
      CHEMISTRY_SERVICE_TOKEN: 'service-token',
    })).toEqual({
      url: 'https://chemistry.example.test',
      token: 'service-token',
    })
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('chemistry service client configuration', () => {
  it('does not attempt a localhost request when the production URL is absent', async () => {
    const fetchMock = vi.fn()
    vi.stubEnv('CHEMISTRY_SERVICE_URL', '')
    vi.stubEnv('CHEMISTRY_SERVICE_TOKEN', 'service-token')
    vi.stubGlobal('fetch', fetchMock)

    const { batchConvert } = await import('@/lib/chemistry-service')
    await expect(batchConvert([{ name: 'ethanol', quantity: '5 mL' }])).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
