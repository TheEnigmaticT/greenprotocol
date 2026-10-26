import type { PDFDocumentProxy } from 'unpdf/pdfjs'
import { MAX_PROTOCOL_CHARS } from '@/lib/protocol-limits'
import { assemblePages, cleanPdfPages, hasPageText } from './clean'
import {
  MAX_PDF_BYTES,
  MAX_PDF_PAGES,
  PDF_IMPORT_TIMEOUT_MS,
  PdfImportError,
} from './errors'
import { analyzePageLayout, formatPageList, layoutWarnings, type PageLayoutFindings, type PdfTextItem } from './layout'

export interface PdfImportResult {
  /** Cleaned, editable procedure text with "[p. N]" page markers (none for a one-page PDF). */
  text: string
  filename: string
  pageCount: number
  /** 1-based pages that had little or no text (for example scanned pages). */
  pagesWithoutText: number[]
  /** Plain-language things to double-check, already formatted for display. */
  warnings: string[]
}

export interface PdfImportOptions {
  signal?: AbortSignal
  /** Overrides for tests; production callers use the defaults. */
  timeoutMs?: number
  maxBytes?: number
  maxPages?: number
  maxChars?: number
}

const PDF_MAGIC = '%PDF-'
const PDF_MAGIC_SEARCH_BYTES = 1024

const CORRUPT_ERROR_NAMES: Record<string, true> = {
  InvalidPDFException: true,
  MissingPDFException: true,
  FormatError: true,
  XRefParseException: true,
}

function mapLoadError(error: unknown): PdfImportError {
  if (error instanceof PdfImportError) return error
  const name = typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : ''
  if (name === 'PasswordException') return new PdfImportError('encrypted')
  if (CORRUPT_ERROR_NAMES[name]) return new PdfImportError('corrupt')
  return new PdfImportError('failed')
}

/** Finds the page on which cumulative text first exceeds the limit. */
function pageWhereLimitIsReached(pages: string[], limit: number): number {
  let total = 0
  for (const [index, page] of pages.entries()) {
    total += page.length + (index > 0 ? 2 : 0)
    if (total > limit) return index + 1
  }
  return pages.length
}

/**
 * Reads a PDF in the browser (or Node) and returns cleaned, reviewable procedure text.
 * Nothing is uploaded: extraction runs on the caller's machine. Throws PdfImportError with a
 * friendly message for every expected failure and never truncates text silently.
 */
export async function extractPdfText(file: File, options: PdfImportOptions = {}): Promise<PdfImportResult> {
  const maxBytes = options.maxBytes ?? MAX_PDF_BYTES
  const maxPages = options.maxPages ?? MAX_PDF_PAGES
  const maxChars = options.maxChars ?? MAX_PROTOCOL_CHARS

  if (file.size > maxBytes) throw new PdfImportError('too_large')
  const header = new TextDecoder('latin1').decode(await file.slice(0, PDF_MAGIC_SEARCH_BYTES).arrayBuffer())
  if (!header.includes(PDF_MAGIC)) throw new PdfImportError('not_a_pdf')

  // Whichever comes first - the caller's cancel or the deadline - rejects `stopped`, which every
  // slow step below races against. Pages are processed one at a time so a stop is noticed between pages.
  const stop = Promise.withResolvers<never>()
  stop.promise.catch(() => {})
  const timer = setTimeout(() => stop.reject(new PdfImportError('timeout')), options.timeoutMs ?? PDF_IMPORT_TIMEOUT_MS)
  const onAbort = () => stop.reject(new PdfImportError('cancelled'))
  if (options.signal?.aborted) onAbort()
  options.signal?.addEventListener('abort', onAbort, { once: true })
  const guard = <T>(work: Promise<T>): Promise<T> => Promise.race([work, stop.promise])

  let document: PDFDocumentProxy | undefined
  try {
    const bytes = new Uint8Array(await guard(file.arrayBuffer()))
    // Loaded on demand so the PDF engine stays out of the page's initial JavaScript.
    const { getDocumentProxy } = await guard(import('unpdf'))
    try {
      document = await guard(getDocumentProxy(bytes, { verbosity: 0 }))
    } catch (error) {
      throw mapLoadError(error)
    }

    const pageCount = document.numPages
    if (pageCount > maxPages) throw new PdfImportError('too_many_pages', { pageCount })

    const rawPages: string[] = []
    const layouts: PageLayoutFindings[] = []
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
      const page = await guard(document.getPage(pageNumber))
      const content = await guard(page.getTextContent())
      const items: PdfTextItem[] = []
      let pageText = ''
      for (const item of content.items) {
        if (!('str' in item)) continue
        const [, , c, d, e, f] = item.transform
        items.push({ str: item.str, x: e, y: f, width: item.width, fontSize: Math.hypot(c, d) })
        pageText += item.hasEOL ? `${item.str}\n` : item.str
      }
      rawPages.push(pageText)
      layouts.push(analyzePageLayout(items))
      page.cleanup()
    }

    const cleaned = cleanPdfPages(rawPages)
    const pagesWithoutText = cleaned.pages.flatMap((page, index) => (hasPageText(page) ? [] : [index + 1]))
    if (pagesWithoutText.length === pageCount) throw new PdfImportError('no_text_layer')

    const text = assemblePages(cleaned.pages)
    if (text.length > maxChars) {
      throw new PdfImportError('too_long', { page: pageWhereLimitIsReached(cleaned.pages, maxChars) })
    }

    const warnings = layoutWarnings(layouts)
    if (pagesWithoutText.length > 0) {
      warnings.unshift(
        `No text found on ${formatPageList(pagesWithoutText)} (scanned or image-only). Paste that part in by hand if it matters.`,
      )
    }
    if (cleaned.removedLines.length > 0) {
      warnings.push('Repeated page headers, footers and page numbers were removed.')
    }

    return { text, filename: file.name, pageCount, pagesWithoutText, warnings }
  } catch (error) {
    throw mapLoadError(error)
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', onAbort)
    await document?.loadingTask.destroy().catch(() => {})
  }
}
