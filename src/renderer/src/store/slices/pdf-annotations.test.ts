import { describe, expect, it, vi } from 'vitest'
import type { PdfAnnotation } from './pdf-annotations'
import { createTestStore } from './store-test-helpers'

vi.mock('@/runtime/close-mirrored-editor-tab', () => ({
  notifyHostOfMirroredEditorClose: vi.fn()
}))

function annotation(fileKey: string, id: string): PdfAnnotation {
  return {
    id,
    fileKey,
    page: 1,
    x: 10,
    y: 20,
    regions: [],
    quote: null,
    comment: `comment ${id}`,
    intent: 'change',
    createdAt: '2026-09-30T00:00:00.000Z'
  }
}

describe('pdf annotations slice', () => {
  it('removes only the delivered annotations, keeping ones added while sending', () => {
    const store = createTestStore()
    const first = annotation('/repo/a.pdf', 'a1')
    store.getState().addPdfAnnotation(first)
    const delivered = store.getState().pdfAnnotationsByFileKey['/repo/a.pdf']
    store.getState().addPdfAnnotation(annotation('/repo/a.pdf', 'a2'))

    store.getState().removeDeliveredPdfAnnotations('/repo/a.pdf', delivered)

    expect(store.getState().pdfAnnotationsByFileKey['/repo/a.pdf']?.map((a) => a.id)).toEqual([
      'a2'
    ])
  })

  it('drops a file’s annotations when its tab closes, and leaves other files alone', async () => {
    const store = createTestStore()
    for (const filePath of ['/repo/a.pdf', '/repo/b.pdf']) {
      store.getState().openFile({
        filePath,
        relativePath: filePath.replace('/repo/', ''),
        worktreeId: 'wt-1',
        language: 'plaintext',
        mode: 'edit'
      })
    }
    const [fileA, fileB] = store.getState().openFiles
    store.getState().addPdfAnnotation(annotation(fileA.id, 'a1'))
    store.getState().addPdfAnnotation(annotation(fileB.id, 'b1'))

    await store.getState().closeFile(fileA.id)

    expect(Object.keys(store.getState().pdfAnnotationsByFileKey)).toEqual([fileB.id])
  })
})
