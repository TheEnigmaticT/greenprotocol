'use client'

import { useEffect, useId, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import {
  MAX_PDF_BYTES,
  MAX_PDF_PAGES,
  PdfImportError,
  extractPdfText,
  pdfImportMessage,
  type PdfImportResult,
} from '@/lib/pdf-import'

interface PdfImportButtonProps {
  onImported: (result: PdfImportResult) => void
  /** Plain-language message, ready to show to the scientist. */
  onError: (message: string) => void
  disabled?: boolean
}

const MAX_MEGABYTES = MAX_PDF_BYTES / (1024 * 1024)

/**
 * "Import from PDF" control. Reads the file in the browser (nothing is uploaded), shows a busy state with
 * Cancel, and doubles as a drop target for desktop drag-and-drop. Never submits anything: the caller puts
 * the text into the editable field for review.
 */
export function PdfImportButton({ onImported, onError, disabled = false }: PdfImportButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const controllerRef = useRef<AbortController | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const helpId = useId()
  const inactive = disabled || busy

  useEffect(() => () => controllerRef.current?.abort(), [])

  async function importFile(file: File) {
    const controller = new AbortController()
    controllerRef.current = controller
    setBusy(true)
    try {
      onImported(await extractPdfText(file, { signal: controller.signal }))
    } catch (error) {
      if (error instanceof PdfImportError) {
        if (error.code !== 'cancelled') onError(error.message)
      } else {
        onError(pdfImportMessage('failed'))
      }
    } finally {
      controllerRef.current = null
      setBusy(false)
    }
  }

  function handlePick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // Reset so choosing the same file again (after fixing it) still fires a change event.
    event.target.value = ''
    if (file) void importFile(file)
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragging(false)
    const file = event.dataTransfer.files[0]
    if (file && !inactive) void importFile(file)
  }

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault()
        if (!inactive) setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-dashed px-4 py-3 transition-colors"
      style={{ borderColor: dragging ? '#1C3822' : '#D6D0C4', background: dragging ? '#F6F3EB' : 'transparent' }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={handlePick}
        disabled={inactive}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={inactive}
        aria-describedby={busy ? undefined : helpId}
        className="min-h-[44px] px-4 rounded-lg border text-sm font-medium transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1C3822]"
        style={{ color: '#1C3822', borderColor: '#1C3822' }}
      >
        Import from PDF
      </button>

      {busy ? (
        <>
          <span role="status" className="text-sm" style={{ color: '#1C3822' }}>
            Reading PDF…
          </span>
          <button
            type="button"
            onClick={() => controllerRef.current?.abort()}
            className="min-h-[44px] px-3 text-sm underline cursor-pointer"
            style={{ color: '#1C3822' }}
          >
            Cancel
          </button>
        </>
      ) : (
        <span id={helpId} className="text-sm min-w-0" style={{ color: '#57534E' }}>
          or drop a PDF here. It is read in your browser and not uploaded (up to {MAX_MEGABYTES} MB, {MAX_PDF_PAGES} pages).
        </span>
      )}
    </div>
  )
}

interface PdfImportNoticeProps {
  result: PdfImportResult
  /** When provided, a checkbox is shown; the caller keeps analysis disabled until it is ticked. */
  acknowledged?: boolean
  onAcknowledgedChange?: (acknowledged: boolean) => void
}

/** Banner shown above the editable text after an import: source, pages, warnings, and the review prompt. */
export function PdfImportNotice({ result, acknowledged = false, onAcknowledgedChange }: PdfImportNoticeProps) {
  const pages = `${result.pageCount} ${result.pageCount === 1 ? 'page' : 'pages'}`
  return (
    <section
      aria-label="PDF import review"
      className="rounded-lg border px-4 py-3 text-sm space-y-2"
      style={{ background: '#F6F3EB', borderColor: '#D6D0C4', color: '#1C1917' }}
    >
      <p className="font-semibold break-words" style={{ color: '#1C3822' }}>
        Imported from {result.filename} ({pages})
      </p>
      <p>Extracted from PDF: check line breaks, subscripts, numbers and units before analyzing.</p>
      {result.warnings.length > 0 && (
        <ul className="list-disc pl-5 space-y-1 border-l-[3px] py-1" style={{ borderColor: '#9D8026' }}>
          {result.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
      {onAcknowledgedChange && (
        <label className="flex items-start gap-3 min-h-[44px] py-2 cursor-pointer">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(event) => onAcknowledgedChange(event.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer accent-[#1C3822]"
          />
          <span>I checked the extracted text below and fixed anything that looks wrong.</span>
        </label>
      )}
    </section>
  )
}
