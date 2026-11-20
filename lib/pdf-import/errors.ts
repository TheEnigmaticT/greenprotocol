import { MAX_PROTOCOL_CHARS } from '@/lib/protocol-limits'

export const MAX_PDF_BYTES = 10 * 1024 * 1024
export const MAX_PDF_PAGES = 30
export const PDF_IMPORT_TIMEOUT_MS = 30_000
/** A page with fewer characters than this (after cleaning) is treated as having no text layer. */
export const MIN_PAGE_TEXT_CHARS = 20

export type PdfImportErrorCode =
  | 'too_large'
  | 'too_many_pages'
  | 'too_long'
  | 'not_a_pdf'
  | 'corrupt'
  | 'no_text_layer'
  | 'encrypted'
  | 'timeout'
  | 'cancelled'
  | 'failed'

export interface PdfImportErrorDetail {
  /** too_many_pages: pages in the file. too_long: the page where the text limit was reached. */
  page?: number
  pageCount?: number
}

const megabytes = MAX_PDF_BYTES / (1024 * 1024)
const charLimit = MAX_PROTOCOL_CHARS.toLocaleString('en-US')

/** Plain-language copy for each failure. Nothing here mentions libraries, codes or file internals. */
export function pdfImportMessage(code: PdfImportErrorCode, detail: PdfImportErrorDetail = {}): string {
  switch (code) {
    case 'too_large':
      return `This PDF is larger than ${megabytes} MB. Save only the pages with the procedure as a smaller PDF, or paste the procedure text instead.`
    case 'too_many_pages': {
      const pages = detail.pageCount ? `This PDF has ${detail.pageCount} pages` : 'This PDF has too many pages'
      return `${pages}, and we can import up to ${MAX_PDF_PAGES}. Save only the pages with the procedure as a new PDF, or paste the procedure text instead.`
    }
    case 'too_long': {
      const where = detail.page ? ` The limit is reached on page ${detail.page}.` : ''
      return `This PDF has more text than we can analyze at once (about ${charLimit} characters).${where} Import only the pages with your procedure, or paste the part you want analyzed.`
    }
    case 'not_a_pdf':
      return "That file doesn't look like a PDF. Choose a .pdf file, or paste the procedure text instead."
    case 'corrupt':
      return "This PDF seems to be damaged, so it can't be read. Try saving or exporting it again, or paste the procedure text instead."
    case 'no_text_layer':
      return 'This PDF looks like a scan, so it has no text to import. Paste the procedure text instead.'
    case 'encrypted':
      return 'This PDF is password-protected. Remove the password in your PDF viewer and try again, or paste the procedure text instead.'
    case 'timeout':
      return 'Reading this PDF took too long. Try a smaller file, or paste the procedure text instead.'
    case 'cancelled':
      return 'PDF import cancelled.'
    case 'failed':
      return "We couldn't read this PDF. Try another copy of it, or paste the procedure text instead."
  }
}

export class PdfImportError extends Error {
  readonly code: PdfImportErrorCode
  readonly detail: PdfImportErrorDetail

  constructor(code: PdfImportErrorCode, detail: PdfImportErrorDetail = {}) {
    super(pdfImportMessage(code, detail))
    this.name = 'PdfImportError'
    this.code = code
    this.detail = detail
  }
}
