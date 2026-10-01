import { expect, test } from '@playwright/test'

const nonce = 'a'.repeat(64)
const sourceHash = 'b'.repeat(64)

test('receiver polls queued work, records an explicit review, and returns a non-empty accepted result', async ({ page, context }) => {
  let statusCalls = 0
  let reviewWrites = 0
  let releaseCompleted!: () => void
  const completedGate = new Promise<void>((resolve) => { releaseCompleted = resolve })
  await context.route('http://localhost:3000/api/integrations/scisure/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.pathname.endsWith('/connections') && request.method() === 'POST') {
      return route.fulfill({ json: { bridgeSessionId: 'bridge-1', credential: 'bridge-secret', principalKind: 'registered' } })
    }
    if (url.pathname.endsWith('/snapshots') && request.method() === 'POST') {
      return route.fulfill({ json: { snapshotId: 'snapshot-1', status: 'queued' } })
    }
    if (url.pathname.endsWith('/status') && request.method() === 'GET') {
      statusCalls += 1
      if (statusCalls > 1) await completedGate
      return route.fulfill({ json: statusCalls === 1
        ? { version: 1, bridgeSessionId: 'bridge-1', snapshotId: 'snapshot-1', sourceHash, runId: 'job-1', status: 'queued' }
        : { version: 1, bridgeSessionId: 'bridge-1', snapshotId: 'snapshot-1', sourceHash, runId: 'job-1', status: 'completed', revisionNumber: 7, recommendations: [{ recommendationId: 'rec-safe', sourceStepId: 'prot-step-1', originalChemical: 'N,N-Dimethylformamide', alternativeChemical: 'Ethyl acetate', kind: 'chemical-substitution', decision: 'proposed', confidence: 'medium', caveats: 'Confirm compatibility before use.', requiresScientistReview: true }] } })
    }
    if (url.pathname.endsWith('/decisions') && request.method() === 'POST') {
      reviewWrites += 1
      return route.fulfill({ json: { recommendationId: 'rec-safe', decision: 'approved_for_experiment', sourceHash, analysisRevision: 7 } })
    }
    return route.fulfill({ status: 404, json: { error: 'Unexpected fixture request' } })
  })
  await context.route('https://sandbox.scisure.test/**', (route) => route.fulfill({ contentType: 'text/html', body: `
    <button id="open">Open receiver</button><pre id="result"></pre>
    <script>
      const nonce = '${nonce}';
      const source = { externalId: 'protocol-7', externalVersionId: 'v2', selection: [{ stepId: 'prot-step-1', order: 1 }] };
      let receiver;
      window.addEventListener('message', (event) => {
        const data = event.data;
        if (!data || typeof data.type !== 'string') return;
        if (data.type === 'gcai.scisure.loaded') receiver.postMessage({ version: 1, type: 'scisure.gcai.hello', nonce }, 'http://localhost:3000');
        if (data.type === 'gcai.scisure.ready') receiver.postMessage({ version: 1, type: 'scisure.gcai.admission', nonce, bridgeSessionId: data.bridgeSessionId, requestId: 'request-1', source }, 'http://localhost:3000');
        if (data.type === 'gcai.scisure.result') document.querySelector('#result').textContent = JSON.stringify(data);
      });
      document.querySelector('#open').addEventListener('click', () => { receiver = window.open('http://localhost:3000/integrations/scisure/connect', 'receiver'); });
    </script>` }))

  await page.goto('https://sandbox.scisure.test/opener.html')
  const [receiver] = await Promise.all([page.waitForEvent('popup'), page.getByRole('button', { name: 'Open receiver' }).click()])
  await expect(receiver.getByText('Source admitted. Analysis is queued; this connection remains open.')).toBeVisible({ timeout: 15_000 })
  releaseCompleted()
  await expect(receiver.getByRole('heading', { name: 'Scientist review required' })).toBeVisible({ timeout: 15_000 })
  await receiver.getByRole('button', { name: 'Approve for experiment' }).click()
  await expect(receiver.getByText('Recorded: approved for experiment.')).toBeVisible()
  await receiver.getByRole('button', { name: 'Return reviewed decisions to SciSure' }).click()
  await expect(receiver.getByText('Scientist decisions returned to SciSure.')).toBeVisible()
  await expect.poll(() => page.locator('#result').textContent()).toContain('"recommendationId":"rec-safe"')
  await expect(page.locator('#result')).toContainText('"decision":"accepted"')
  expect(reviewWrites).toBe(1)
  expect(statusCalls).toBeGreaterThanOrEqual(2)
  await receiver.screenshot({ path: 'test-results/scisure-connect-reviewed-return.png', fullPage: true })
})
