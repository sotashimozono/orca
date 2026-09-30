import type { StateCreator } from 'zustand'
import type { AppState } from '../types'
import type { BrowserAnnotationIntent } from '../../../../shared/browser-grab-types'

/** A dragged box on one page, in PDF points from that page's top-left. */
export type PdfRegion = { page: number; left: number; top: number; right: number; bottom: number }

/** A comment pinned to a point on a PDF page; in-memory like browser Design Mode annotations. */
export type PdfAnnotation = {
  id: string
  /** Owner-qualified editor file id, so two worktrees' copies of a PDF stay separate. */
  fileKey: string
  /** 1-based page; x/y in PDF points from the page's top-left. Where the badge sits. */
  page: number
  x: number
  y: number
  /** Empty for a plain click; one or more boxes when dragged (Shift+drag adds more). */
  regions: PdfRegion[]
  quote: string | null
  comment: string
  intent: BrowserAnnotationIntent
  createdAt: string
}

export type PdfAnnotationsSlice = {
  pdfAnnotationsByFileKey: Record<string, PdfAnnotation[]>
  addPdfAnnotation: (annotation: PdfAnnotation) => void
  updatePdfAnnotation: (
    fileKey: string,
    annotationId: string,
    patch: Pick<PdfAnnotation, 'comment' | 'intent'>
  ) => void
  deletePdfAnnotation: (fileKey: string, annotationId: string) => void
  clearPdfAnnotations: (fileKey: string) => void
  /** Removes only what was sent, so notes added while the agent picker was open survive. */
  removeDeliveredPdfAnnotations: (fileKey: string, delivered: readonly PdfAnnotation[]) => void
}

export const createPdfAnnotationsSlice: StateCreator<AppState, [], [], PdfAnnotationsSlice> = (
  set
) => {
  const replaceFileAnnotations = (
    state: AppState,
    fileKey: string,
    next: PdfAnnotation[]
  ): Pick<AppState, 'pdfAnnotationsByFileKey'> => {
    const byFileKey = { ...state.pdfAnnotationsByFileKey }
    if (next.length === 0) {
      delete byFileKey[fileKey]
    } else {
      byFileKey[fileKey] = next
    }
    return { pdfAnnotationsByFileKey: byFileKey }
  }
  const annotationsFor = (state: AppState, fileKey: string): PdfAnnotation[] =>
    state.pdfAnnotationsByFileKey[fileKey] ?? []

  return {
    pdfAnnotationsByFileKey: {},
    addPdfAnnotation: (annotation) =>
      set((s) =>
        replaceFileAnnotations(s, annotation.fileKey, [
          ...annotationsFor(s, annotation.fileKey),
          annotation
        ])
      ),
    updatePdfAnnotation: (fileKey, annotationId, patch) =>
      set((s) =>
        replaceFileAnnotations(
          s,
          fileKey,
          annotationsFor(s, fileKey).map((annotation) =>
            annotation.id === annotationId ? { ...annotation, ...patch } : annotation
          )
        )
      ),
    deletePdfAnnotation: (fileKey, annotationId) =>
      set((s) =>
        replaceFileAnnotations(
          s,
          fileKey,
          annotationsFor(s, fileKey).filter((annotation) => annotation.id !== annotationId)
        )
      ),
    clearPdfAnnotations: (fileKey) => set((s) => replaceFileAnnotations(s, fileKey, [])),
    removeDeliveredPdfAnnotations: (fileKey, delivered) => {
      // Why: an edit made after sending keeps the note, since the agent saw the old text.
      const sent = new Set(delivered)
      set((s) =>
        replaceFileAnnotations(
          s,
          fileKey,
          annotationsFor(s, fileKey).filter((annotation) => !sent.has(annotation))
        )
      )
    }
  }
}
