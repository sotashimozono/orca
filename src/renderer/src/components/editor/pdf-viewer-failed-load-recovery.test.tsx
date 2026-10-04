// @vitest-environment happy-dom

import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PdfViewer from './PdfViewer'

const getDocument = vi.hoisted(() => vi.fn())
// Every document any viewer was told to show, in order (null = torn down).
const shownDocuments = vi.hoisted((): unknown[] => [])

vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument }))
vi.mock('pdfjs-dist/web/pdf_viewer.mjs', () => {
  class EventBus {
    on(): void {}
    off(): void {}
    dispatch(): void {}
  }
  class PDFLinkService {
    setViewer(): void {}
    setDocument(): void {}
  }
  class PDFFindController {
    setDocument(): void {}
  }
  class PDFViewer {
    pagesCount = 0
    currentScale = 1
    currentScaleValue = 'page-width'
    setDocument(doc: unknown): void {
      shownDocuments.push(doc)
    }
    scrollPageIntoView(): void {}
    update(): void {}
  }
  return { EventBus, PDFLinkService, PDFFindController, PDFViewer }
})
vi.mock('pdfjs-dist/web/pdf_viewer.css', () => ({}))
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))
vi.mock('@/hooks/useShortcutLabel', () => ({ useShortcutLabel: () => '' }))
vi.mock('@/store', () => ({
  useAppStore: (selector: (state: { keybindings: Record<string, never> }) => unknown) =>
    selector({ keybindings: {} })
}))

const ERROR_TEXT = 'Failed to load PDF preview'

function loadingTask(doc: object | 'fail'): {
  promise: Promise<unknown>
  destroy: () => Promise<void>
} {
  return {
    promise:
      doc === 'fail' ? Promise.reject(new Error('Invalid PDF structure')) : Promise.resolve(doc),
    destroy: () => Promise.resolve()
  }
}

afterEach(() => {
  cleanup()
  getDocument.mockReset()
  shownDocuments.length = 0
})

describe('PdfViewer when the file is rewritten', () => {
  // A LaTeX build rewrites the PDF over several seconds, so the external-change
  // reload can read a half-written file before the finished one lands.
  it('loads the next version of the file instead of staying on the error', async () => {
    const finished = { name: 'finished' }
    getDocument
      .mockImplementationOnce(() => loadingTask('fail'))
      .mockImplementationOnce(() => loadingTask(finished))
    const view = render(<PdfViewer content={btoa('%PDF half-written')} filePath="out/main.pdf" />)
    await waitFor(() => expect(view.queryByText(ERROR_TEXT)).toBeTruthy())

    view.rerender(<PdfViewer content={btoa('%PDF finished %%EOF')} filePath="out/main.pdf" />)

    await waitFor(() => expect(view.queryByText(ERROR_TEXT)).toBeNull())
    expect(shownDocuments.at(-1)).toBe(finished)
  })

  it('keeps showing the last good version while a rebuild writes a broken one', async () => {
    const previous = { name: 'previous build' }
    const next = { name: 'next build' }
    getDocument
      .mockImplementationOnce(() => loadingTask(previous))
      .mockImplementationOnce(() => loadingTask('fail'))
      .mockImplementationOnce(() => loadingTask(next))
    const view = render(<PdfViewer content={btoa('%PDF v1')} filePath="out/main.pdf" />)
    await waitFor(() => expect(shownDocuments.at(-1)).toBe(previous))

    view.rerender(<PdfViewer content={btoa('%PDF v2 half-written')} filePath="out/main.pdf" />)
    await waitFor(() => expect(getDocument).toHaveBeenCalledTimes(2))
    // Let the rejected load settle before checking nothing changed on screen.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(view.queryByText(ERROR_TEXT)).toBeNull()
    expect(shownDocuments.at(-1)).toBe(previous)

    view.rerender(<PdfViewer content={btoa('%PDF v2 finished')} filePath="out/main.pdf" />)
    await waitFor(() => expect(shownDocuments.at(-1)).toBe(next))
  })

  it('does not keep another file on screen when the newly opened one fails', async () => {
    getDocument
      .mockImplementationOnce(() => loadingTask({ name: 'a.pdf' }))
      .mockImplementationOnce(() => loadingTask('fail'))
    const view = render(<PdfViewer content={btoa('%PDF a')} filePath="a.pdf" />)
    await waitFor(() => expect(shownDocuments.length).toBe(1))

    view.rerender(<PdfViewer content={btoa('%PDF b broken')} filePath="b.pdf" />)

    await waitFor(() => expect(view.queryByText(ERROR_TEXT)).toBeTruthy())
    expect(shownDocuments.at(-1)).toBeNull()
  })

  it('keeps the document when its own file reads empty mid-rebuild', async () => {
    const previous = { name: 'previous build' }
    getDocument.mockImplementationOnce(() => loadingTask(previous))
    const view = render(<PdfViewer content={btoa('%PDF v1')} filePath="out/main.pdf" />)
    await waitFor(() => expect(shownDocuments.at(-1)).toBe(previous))

    view.rerender(<PdfViewer content="" filePath="out/main.pdf" />)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(shownDocuments.at(-1)).toBe(previous)
    expect(view.queryByText(ERROR_TEXT)).toBeNull()
  })

  it('does not keep another file on screen when the newly opened one is empty', async () => {
    getDocument.mockImplementationOnce(() => loadingTask({ name: 'a.pdf' }))
    const view = render(<PdfViewer content={btoa('%PDF a')} filePath="a.pdf" />)
    await waitFor(() => expect(shownDocuments.length).toBe(1))

    view.rerender(<PdfViewer content="" filePath="empty.pdf" />)

    await waitFor(() => expect(shownDocuments.at(-1)).toBeNull())
    expect(view.queryByText(ERROR_TEXT)).toBeNull()
  })
})
