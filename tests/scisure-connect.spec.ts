import { expect, test } from '@playwright/test'

// Synthetic fixture: every API response is intercepted. This proves the popup UI and the
// postMessage contract, not a live database, provider, or SciSure sandbox round trip.
const nonce = 'a'.repeat(64)
const sourceHash = 'b'.repeat(64)
const bridgeSessionId = '00000000-0000-0000-0000-000000000001'
const snapshotId = '00000000-0000-0000-0000-000000000002'
const rec = (over: Record<string, unknown>) => ({
  stepNumber: 1, principleNumbers: [5], principleNames: ['Safer solvents'], severity: 'high', confidenceLevel: 'medium',
  original: { chemical: 'N,N-Dimethylformamide', issue: 'Reprotoxic solvent.' },
  alternative: { chemical: 'Cyrene', rationale: 'Bio-derived dipolar aprotic solvent.', yieldImpact: 'Unknown', caveats: 'Validate experimentally.', evidenceBasis: 'Fixture' },
  ...over,
})
const findings = [
  { findingId: 'warn-1', recommendationIndex: 0, applicable: false, decision: null, recommendation: rec({ id: 'warn-1', cardKind: 'warning', alternative: { chemical: '', rationale: '', yieldImpact: '', caveats: 'No substitute.', evidenceBasis: 'Fixture' } }) },
  { findingId: 'swap-1', recommendationIndex: 1, applicable: true, decision: null, recommendation: rec({ id: 'swap-1', cardKind: 'swap' }) },
]
const workspace = {
  version: 2, bridgeSessionId, snapshotId, sourceHash, runId: '00000000-0000-0000-0000-000000000003', status: 'completed', principalKind: 'guest', analysisRevision: 0,
  source: { version: 1, kind: 'protocol', externalId: 'protocol-7', externalVersionId: 'v2', title: 'Fixture amide coupling', retrievedAt: '2026-10-01T00:00:00Z', selection: [{ stepId: 'prot-step-1', order: 1, title: 'Couple', originalContent: 'Dissolve in DMF.', normalizedText: 'Dissolve in DMF.', warnings: [] }], protocolText: 'Dissolve in DMF.', importWarnings: [] },
  analysis: { protocolTitle: 'Fixture', recommendations: [], steps: [] }, findings, retentionExpiresAt: '2099-01-01T00:00:00Z',
}
const bundle = { version: 2, snapshotId, sourceHash, runId: workspace.runId, analysisRevision: 0, source: workspace.source, title: 'Fixture amide coupling — reviewed GCai draft', draftText: 'Dissolve in Cyrene.', evidenceAppendixText: 'Private evidence appendix fixture.', appliedFindingIds: ['swap-1'], acknowledgedFindingIds: ['warn-1'], limitations: ['Fixture limitation: no section mapping.'], preparedAt: '2026-10-26T00:00:00Z', bundleHash: 'c'.repeat(64) }

test('popup review: every finding decided, draft previewed, explicit confirmation, create-only writeback verified by the add-on reply', async ({ page, context }) => {
  const decisions: Array<Record<string, unknown>> = []
  let draftCalls = 0
  let releaseCompleted!: () => void
  const completedGate = new Promise<void>((resolve) => { releaseCompleted = resolve })
  let statusCalls = 0
  await context.route('http://localhost:3000/api/integrations/scisure/**', async (route) => {
    const request = route.request(); const url = new URL(request.url()); const path = url.pathname
    if (path.endsWith('/connections') && request.method() === 'POST') return route.fulfill({ json: { bridgeSessionId, credential: 'bridge-secret', principalKind: 'guest' } })
    if (path.endsWith('/snapshots') && request.method() === 'POST') return route.fulfill({ json: { snapshotId, status: 'queued' } })
    if (path.endsWith('/status')) {
      statusCalls += 1
      if (statusCalls > 1) await completedGate
      return route.fulfill({ json: { version: 1, bridgeSessionId, snapshotId, sourceHash, runId: workspace.runId, status: statusCalls === 1 ? 'queued' : 'completed' } })
    }
    if (path.endsWith('/workspace') && request.method() === 'GET') {
      expect(request.headers().authorization).toBe('Bearer bridge-secret')
      return route.fulfill({ json: { ...workspace, findings: findings.map(f => ({ ...f, decision: decisions.find(d => d.findingId === f.findingId)?.decision ?? null })) } })
    }
    if (path.endsWith('/workspace/decisions') && request.method() === 'POST') {
      const body = request.postDataJSON() as Record<string, unknown>; decisions.push(body)
      return route.fulfill({ json: { findingId: body.findingId, decision: body.decision, analysisRevision: 0 } })
    }
    if (path.endsWith('/workspace/draft') && request.method() === 'POST') { draftCalls += 1; return route.fulfill({ json: bundle }) }
    return route.fulfill({ status: 404, json: { error: 'Unexpected fixture request' } })
  })
  await context.route('https://sandbox.scisure.test/**', (route) => route.fulfill({ contentType: 'text/html', body: `
    <button id="open">Open receiver</button><pre id="writeback"></pre>
    <script>
      const nonce = '${nonce}';
      const source = { externalId: 'protocol-7', externalVersionId: 'v2', selection: [{ stepId: 'prot-step-1', order: 1 }] };
      let receiver;
      window.addEventListener('message', (event) => {
        const data = event.data;
        if (!data || typeof data.type !== 'string') return;
        if (data.type === 'gcai.scisure.loaded') receiver.postMessage({ version: 1, type: 'scisure.gcai.hello', nonce }, 'http://localhost:3000');
        if (data.type === 'gcai.scisure.ready') receiver.postMessage({ version: 1, type: 'scisure.gcai.admission', nonce, bridgeSessionId: data.bridgeSessionId, requestId: 'request-1', source }, 'http://localhost:3000');
        if (data.type === 'gcai.scisure.writeback') {
          document.querySelector('#writeback').textContent = JSON.stringify({ mode: data.mode, snapshot: data.snapshot, nonce: data.nonce, bundleHash: data.bundle.bundleHash });
          receiver.postMessage({ version: 2, type: 'scisure.gcai.writeback-result', nonce: data.nonce, bridgeSessionId: data.bridgeSessionId, requestId: data.requestId, status: 'saved', message: 'New protocol verified by exact ID readback.', targetId: 'protocol-99', targetKind: 'protocol' }, 'http://localhost:3000');
        }
      });
      document.querySelector('#open').addEventListener('click', () => { receiver = window.open('http://localhost:3000/integrations/scisure/connect', 'receiver'); });
    </script>` }))

  await page.goto('https://sandbox.scisure.test/opener.html')
  const [receiver] = await Promise.all([page.waitForEvent('popup'), page.getByRole('button', { name: 'Open receiver' }).click()])
  await expect(receiver.getByText('Source admitted. Analysis is queued; this connection remains open.')).toBeVisible({ timeout: 15_000 })
  releaseCompleted()
  await expect(receiver.getByRole('heading', { name: 'Scientist review' })).toBeVisible({ timeout: 15_000 })
  await expect(receiver.getByText('Hazard warning', { exact: false })).toBeVisible()
  await expect(receiver.getByText('Acknowledging this finding never changes the procedure.')).toBeVisible()

  // A draft is impossible until both findings, including the warning, have a decision.
  const prepare = receiver.getByRole('button', { name: 'Prepare reviewed draft' })
  await expect(prepare).toBeDisabled()
  await receiver.getByRole('button', { name: 'Acknowledge' }).click()
  await expect(prepare).toBeDisabled()
  await receiver.getByRole('button', { name: 'Accept change' }).click()
  await expect(prepare).toBeEnabled()
  expect(decisions).toEqual([
    { sourceHash, analysisRevision: 0, findingId: 'warn-1', decision: 'accepted' },
    { sourceHash, analysisRevision: 0, findingId: 'swap-1', decision: 'accepted' },
  ])
  await prepare.click()
  await expect(receiver.getByText('Dissolve in Cyrene.')).toBeVisible()
  await expect(receiver.getByText('1 change applied, 1 finding acknowledged only.')).toBeVisible()
  await expect(receiver.getByText('Fixture limitation: no section mapping.')).toBeVisible()
  await expect(receiver.getByText(/Updating the existing record is unavailable/)).toBeVisible()

  // Nothing reaches SciSure until the scientist explicitly confirms.
  const create = receiver.getByRole('button', { name: 'Create new protocol in SciSure' })
  await expect(create).toBeDisabled()
  await expect(page.locator('#writeback')).toHaveText('')
  await receiver.getByRole('checkbox').check()
  await create.click()
  await expect(receiver.getByText(/Saved\. New protocol verified by exact ID readback\. Record ID: protocol-99\./)).toBeVisible()
  const sent = JSON.parse(await page.locator('#writeback').textContent() ?? '{}')
  expect(sent).toMatchObject({ mode: 'create', nonce, bundleHash: bundle.bundleHash, snapshot: { externalId: 'protocol-7', externalVersionId: 'v2', selectionIds: ['prot-step-1'] } })
  expect(draftCalls).toBe(1)
  // After a saved record the review is frozen: no retry and no changed decisions.
  await expect(create).toBeDisabled()
  await expect(receiver.getByRole('button', { name: 'Reject change' })).toBeDisabled()
  await receiver.screenshot({ path: 'test-results/scisure-connect-v2-review.png', fullPage: true })
})
