import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { MAX_PDF_BYTES, PdfImportError, extractPdfText, pdfImportMessage, type PdfImportErrorCode } from '@/lib/pdf-import'

const FIXTURES = path.join(process.cwd(), 'tests/fixtures/pdf')

function fixtureBytes(name: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(readFileSync(path.join(FIXTURES, name)))
}

function fixture(name: string): File {
  return new File([fixtureBytes(name)], name, { type: 'application/pdf' })
}

async function failureOf(file: File, options?: Parameters<typeof extractPdfText>[1]): Promise<PdfImportError> {
  const error = await extractPdfText(file, options).then(
    () => null,
    (caught: unknown) => caught,
  )
  expect(error).toBeInstanceOf(PdfImportError)
  return error as PdfImportError
}

describe('extractPdfText: a real multi-page procedure', () => {
  it('returns cleaned text with page markers, filename and page count', async () => {
    const result = await extractPdfText(fixture('procedure.pdf'))
    expect(result.filename).toBe('procedure.pdf')
    expect(result.pageCount).toBe(3)
    expect(result.pagesWithoutText).toEqual([])
    expect(result.text).toContain('[p. 1]\nGeneral procedure for the amide coupling')
    expect(result.text).toContain('\n\n[p. 2]\n4. The aqueous layer')
    expect(result.text).toContain('\n\n[p. 3]\nNotes')
  })

  it('reflows wrapped lines, repairs the line-end hyphens and keeps chemical names', async () => {
    const { text } = await extractPdfText(fixture('procedure.pdf'))
    expect(text).toContain('N-methylpyrrolidone (20 mL)')
    expect(text).toContain('stirred at room temperature until a clear solution formed.')
    expect(text).toContain('\n2. Benzylamine (1.18 g, 11.0 mmol)')
    expect(text).toContain('\n3. EDC hydrochloride (2.30 g, 12.0 mmol)')
    expect(text).not.toMatch(/tem-\s*perature/)
  })

  it('leaves quantities and units exactly as written', async () => {
    const { text } = await extractPdfText(fixture('procedure.pdf'))
    for (const token of ['100 mL', '1.22 g', '10.0 mmol', '0 degrees C', '25 \u00B0C', '12 h', '3 x 30 mL', '1 M, 10 mL', '(1.85 g, 88%)']) {
      expect(text).toContain(token)
    }
  })

  it('removes the running header and page-number footer', async () => {
    const { text, warnings } = await extractPdfText(fixture('procedure.pdf'))
    expect(text).not.toContain('Supporting Information')
    expect(text).not.toContain('Org. Process')
    expect(warnings).toContain('Repeated page headers, footers and page numbers were removed.')
  })

  it('warns that subscripts and charges were flattened, naming the page', async () => {
    const { text, warnings } = await extractPdfText(fixture('procedure.pdf'))
    expect(text).toContain('aqueous H2SO4 (1 M, 10 mL)')
    expect(text).toContain('Fe3+ traces')
    expect(warnings.some((warning) => warning.includes('flattened') && warning.includes('page 1'))).toBe(true)
  })
})

describe('extractPdfText: layout and partial text', () => {
  it('warns about a two-column page without dropping or reordering any text', async () => {
    const { text, warnings, pageCount } = await extractPdfText(fixture('two-column.pdf'))
    expect(pageCount).toBe(1)
    expect(text).not.toContain('[p. 1]')
    expect(warnings).toEqual(['Possible two-column layout on page 1. Check that the text reads in the right order.'])
    expect(text.indexOf('Procedure A')).toBeLessThan(text.indexOf('Procedure B'))
    expect(text).toContain('(92%)')
  })

  it('imports the text pages of a mixed PDF and reports the scanned page', async () => {
    const result = await extractPdfText(fixture('mixed.pdf'))
    expect(result.pagesWithoutText).toEqual([2])
    expect(result.warnings[0]).toContain('No text found on page 2')
    expect(result.text).toContain('[p. 2: no text found on this page]')
    expect(result.text).toContain('[p. 3]\n3. The reaction was quenched')
  })
})

describe('extractPdfText: refusals', () => {
  it('refuses a scanned PDF with the plain-language scan message', async () => {
    const error = await failureOf(fixture('scanned.pdf'))
    expect(error.code).toBe('no_text_layer')
    expect(error.message).toBe('This PDF looks like a scan, so it has no text to import. Paste the procedure text instead.')
  })

  it('refuses a password-protected PDF', async () => {
    expect((await failureOf(fixture('encrypted.pdf'))).code).toBe('encrypted')
  })

  it('refuses a PDF over the page limit and says how many pages it has', async () => {
    const error = await failureOf(fixture('thirty-one-pages.pdf'))
    expect(error.code).toBe('too_many_pages')
    expect(error.message).toContain('31 pages')
    expect(error.message).toContain('30')
  })

  it('accepts exactly the page limit', async () => {
    const result = await extractPdfText(fixture('thirty-one-pages.pdf'), { maxPages: 31 })
    expect(result.pageCount).toBe(31)
    expect(result.text).toContain('[p. 31]')
  })

  it('refuses text over the character limit instead of truncating, naming the page where it was reached', async () => {
    const error = await failureOf(fixture('procedure.pdf'), { maxChars: 600 })
    expect(error.code).toBe('too_long')
    expect(error.detail.page).toBe(2)
    expect(error.message).toContain('page 2')
  })

  it('refuses a file over the size limit before reading it', async () => {
    const error = await failureOf(fixture('procedure.pdf'), { maxBytes: 100 })
    expect(error.code).toBe('too_large')
    expect(MAX_PDF_BYTES).toBe(10 * 1024 * 1024)
  })

  it.each([
    ['plain text', new File(['1. Stir the mixture for 5 min.'], 'procedure.pdf', { type: 'application/pdf' })],
    ['an empty file', new File([], 'empty.pdf', { type: 'application/pdf' })],
    ['a Word document renamed to .pdf', new File([new TextEncoder().encode('PK\u0003\u0004word/document.xml')], 'protocol.pdf', { type: 'application/pdf' })],
  ])('refuses %s even when it is named .pdf', async (_label, file) => {
    expect((await failureOf(file)).code).toBe('not_a_pdf')
  })

  it('accepts a PDF whose type is empty (some mobile browsers) because the header decides', async () => {
    const result = await extractPdfText(new File([fixtureBytes('two-column.pdf')], 'scan0001'))
    expect(result.text).toContain('Procedure A')
  })

  it('reports a truncated PDF as damaged', async () => {
    const truncated = new File([fixtureBytes('procedure.pdf').slice(0, 3000)], 'cut.pdf')
    expect((await failureOf(truncated)).code).toBe('corrupt')
  })

  it('reports a PDF header followed by garbage as damaged', async () => {
    const garbage = new File(['%PDF-1.4\nthis is not really a pdf\n%%EOF'], 'bad.pdf')
    expect((await failureOf(garbage)).code).toBe('corrupt')
  })
})

describe('extractPdfText: time limit and cancelling', () => {
  it('stops with a timeout error when the deadline passes', async () => {
    const error = await failureOf(fixture('thirty-one-pages.pdf'), { timeoutMs: 0, maxPages: 40 })
    expect(error.code).toBe('timeout')
  })

  it('stops with a cancelled error when the signal is already aborted', async () => {
    const error = await failureOf(fixture('procedure.pdf'), { signal: AbortSignal.abort() })
    expect(error.code).toBe('cancelled')
  })

  it('stops when the signal aborts during extraction', async () => {
    const controller = new AbortController()
    const pending = failureOf(fixture('thirty-one-pages.pdf'), { signal: controller.signal, maxPages: 40 })
    controller.abort()
    expect((await pending).code).toBe('cancelled')
  })
})

describe('pdfImportMessage', () => {
  const codes: PdfImportErrorCode[] = ['too_large', 'too_many_pages', 'too_long', 'not_a_pdf', 'corrupt', 'no_text_layer', 'encrypted', 'timeout', 'cancelled', 'failed']

  it.each(codes)('%s is plain language with no internals', (code) => {
    const message = pdfImportMessage(code)
    expect(message.length).toBeGreaterThan(10)
    expect(message).not.toMatch(/undefined|null|exception|pdf\.?js|unpdf|stack|\b[a-z]+_[a-z_]+\b|\d{3}\b(?! characters)/i)
  })

  it('the size and length limits quoted to the user come from the real limits', () => {
    expect(pdfImportMessage('too_large')).toContain('10 MB')
    expect(pdfImportMessage('too_long', { page: 4 })).toContain('50,000 characters')
    expect(pdfImportMessage('too_long', { page: 4 })).toContain('page 4')
  })
})
