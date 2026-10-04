// @vitest-environment happy-dom

import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PdfViewer from './PdfViewer'

const getDocument = vi.hoisted(() => vi.fn())

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
    setDocument(): void {}
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

function loadingTask(outcome: 'fail' | 'ok'): {
  promise: Promise<unknown>
  destroy: () => Promise<void>
} {
  return {
    promise:
      outcome === 'fail' ? Promise.reject(new Error('Invalid PDF structure')) : Promise.resolve({}),
    destroy: () => Promise.resolve()
  }
}

afterEach(() => {
  cleanup()
  getDocument.mockReset()
})

describe('PdfViewer after a failed load', () => {
  // A LaTeX build rewrites the PDF over several seconds, so the external-change
  // reload can read a half-written file before the finished one lands.
  it('loads the next version of the file instead of staying on the error', async () => {
    getDocument.mockReturnValueOnce(loadingTask('fail')).mockReturnValueOnce(loadingTask('ok'))
    const view = render(
      <PdfViewer content={btoa('%PDF-1.5 half-written')} filePath="out/main.pdf" />
    )
    await waitFor(() => expect(view.queryByText('Failed to load PDF preview')).toBeTruthy())

    view.rerender(<PdfViewer content={btoa('%PDF-1.5 finished %%EOF')} filePath="out/main.pdf" />)

    await waitFor(() => expect(getDocument).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(view.queryByText('Failed to load PDF preview')).toBeNull())
  })
})
