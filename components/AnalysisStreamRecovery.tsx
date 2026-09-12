'use client'

type AnalysisStreamRecoveryProps = {
  onOpenDashboard: () => void
}

export function AnalysisStreamRecovery({ onOpenDashboard }: AnalysisStreamRecoveryProps) {
  return (
    <div
      role="alert"
      className="rounded-lg border p-4 space-y-3"
      style={{ background: '#FFF7ED', borderColor: '#FB923C', color: '#7C2D12' }}
    >
      <p className="text-sm font-medium">We lost the connection to the progress screen.</p>
      <p className="text-sm">
        Your analysis may still be running and will be saved when it finishes. Wait a few minutes, then open the dashboard to find it. Do not submit the same protocol again.
      </p>
      <button
        type="button"
        onClick={onOpenDashboard}
        className="rounded-lg px-3 py-2 text-sm font-medium"
        style={{ background: '#1C3822', color: '#FAF8F3' }}
      >
        Open dashboard
      </button>
    </div>
  )
}
