import { readFileSync, existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const deployment = readFileSync('scripts/deploy-scisure-worker-staging.sh', 'utf8')
const config = JSON.parse(readFileSync('vercel.json', 'utf8')) as { crons: { path: string }[] }

describe('SciSure staging worker operational contract', () => {
  it('deploys the chemistry URL along with all model-routing metadata', () => {
    expect(deployment).toContain('CHEMISTRY_SERVICE_URL=$CHEMISTRY_URL')
    for (const variable of ['GIT_SHA=$GIT_SHA', 'DEPLOY_ENV=staging', 'GCAI_ENGINE_CANDIDATE=1', 'GCAI_LLM_BASE_URL=https://openrouter.ai/api/v1', 'GCAI_LLM_MODEL=$MODEL']) {
      expect(deployment).toContain(variable)
    }
  })

  it('binds the staging chemistry token from Secret Manager', () => {
    expect(deployment).toContain('staging-chemistry-service-token')
    expect(deployment).toContain('CHEMISTRY_SERVICE_TOKEN=${CHEMISTRY_TOKEN_SECRET}:latest')
    expect(deployment).toContain('"$CHEMISTRY_TOKEN_SECRET"; do')
  })

  it('does not schedule the staging worker on production-only Vercel Cron', () => {
    expect(config.crons.some(cron => cron.path.startsWith('/api/scisure/'))).toBe(false)
    expect(config.crons.some(cron => cron.path === '/api/operational-alerts/sentinel-daily')).toBe(true)
  })

  it('uses a stable manual worker route instead of cache-busting route names', () => {
    expect(existsSync('app/api/scisure/worker-tick/route.ts')).toBe(true)
  })
})
