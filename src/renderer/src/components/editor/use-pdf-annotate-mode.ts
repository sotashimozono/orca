import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs'
import { useAppStore } from '@/store'
import type { PdfAnnotation, PdfRegion } from '@/store/slices/pdf-annotations'
import type { BrowserAnnotationIntent } from '../../../../shared/browser-grab-types'
import { pdfPagePointAt, pdfRegionFromClientRect, type PdfPagePoint } from './pdf-page-geometry'
import { projectPdfAnnotations } from './pdf-annotation-projection'
import {
  dragRectOnPage,
  contentRectBetween,
  joinQuotes,
  paragraphAt,
  TEXT_RUN_SELECTOR,
  textInClientRect,
  type PdfContentRect
} from './pdf-text-layer-text'
import { isAnnotateModeExitKey } from './pdf-annotate-exit-key'

/** Where a PDF's annotations belong; absent for diff/conflict viewers, which cannot annotate. */
export type PdfAnnotationContext = {
  fileKey: string
  worktreeId: string
  displayPath: string
}

export type { PdfContentRect }

type PendingPdfAnnotation = PdfPagePoint & {
  fileKey: string
  regions: PdfRegion[]
  quote: string | null
}

type Drag = { pageDiv: HTMLElement; startX: number; startY: number; append: boolean }

const EMPTY_PDF_ANNOTATIONS: PdfAnnotation[] = []
// Below this many pixels a press is a click (pin), not a region drag.
const DRAG_THRESHOLD_PX = 4

/** Browser Design Mode's annotate loop, over a pdf.js page stack instead of a guest DOM. */
export function usePdfAnnotateMode({
  context,
  containerRef,
  viewerDivRef,
  pdfViewerRef
}: {
  context: PdfAnnotationContext | null
  containerRef: RefObject<HTMLDivElement | null>
  viewerDivRef: RefObject<HTMLDivElement | null>
  pdfViewerRef: RefObject<PDFViewer | null>
}) {
  const fileKey = context?.fileKey ?? null
  // Why: the viewer is reused across PDF tabs, so mode and draft are tagged with their file
  // and read as off/empty once another file is shown, never saved under the wrong one.
  const [armedFileKey, setArmedFileKey] = useState<string | null>(null)
  const [pendingDraft, setPending] = useState<PendingPdfAnnotation | null>(null)
  const active = fileKey !== null && armedFileKey === fileKey
  const pending = pendingDraft?.fileKey === fileKey ? pendingDraft : null
  const [hoverRect, setHoverRect] = useState<PdfContentRect | null>(null)
  const [dragRect, setDragRect] = useState<PdfContentRect | null>(null)
  // The non-scrolling wrapper the comment card portals into and clamps against.
  const [surface, setSurface] = useState<HTMLDivElement | null>(null)
  // Re-renders on zoom/first layout so overlays re-project from live pdf.js geometry.
  const [, setLayoutVersion] = useState(0)
  const pendingRef = useRef(pending)
  const annotations = useAppStore((s) =>
    fileKey ? (s.pdfAnnotationsByFileKey[fileKey] ?? EMPTY_PDF_ANNOTATIONS) : EMPTY_PDF_ANNOTATIONS
  )
  const addPdfAnnotation = useAppStore((s) => s.addPdfAnnotation)

  useEffect(() => {
    pendingRef.current = pending
  }, [pending])

  useEffect(() => {
    const viewerDiv = viewerDivRef.current
    if (!viewerDiv) {
      return
    }
    const observer = new ResizeObserver(() => setLayoutVersion((version) => version + 1))
    observer.observe(viewerDiv)
    return () => observer.disconnect()
  }, [viewerDivRef])

  const stop = useCallback((): void => {
    setArmedFileKey(null)
    setPending(null)
    setHoverRect(null)
    setDragRect(null)
  }, [])

  useEffect(() => {
    const container = containerRef.current
    const key = fileKey
    if (!active || !container || !key) {
      return
    }
    let drag: Drag | null = null

    // Adds a box to the open draft (Shift) or starts a new draft with it.
    const addArea = (
      viewer: PDFViewer,
      pageDiv: Element,
      clientRect: DOMRect,
      quote: string | null,
      append: boolean
    ): void => {
      const region = pdfRegionFromClientRect(viewer, pageDiv, clientRect)
      if (!region) {
        return
      }
      const previous = append ? pendingRef.current : null
      const regions = [...(previous?.regions ?? []), region]
      if (previous) {
        setPending({ ...previous, regions, quote: joinQuotes(previous.quote, quote) })
        return
      }
      setPending({ fileKey: key, page: region.page, x: region.left, y: region.top, regions, quote })
    }

    // A click on text picks its whole paragraph, like Design Mode picks an element; elsewhere it pins.
    const finishClick = (
      viewer: PDFViewer,
      target: Element,
      x: number,
      y: number,
      append: boolean
    ): void => {
      const paragraph = paragraphAt(target)
      if (paragraph) {
        addArea(viewer, paragraph.pageDiv, paragraph.rect, paragraph.text, append)
        return
      }
      const point = append ? null : pdfPagePointAt(viewer, target, x, y)
      if (point) {
        setPending({ ...point, fileKey: key, regions: [], quote: null })
      }
    }

    const finishRegion = (viewer: PDFViewer, released: Drag, endX: number, endY: number): void => {
      const clientRect = dragRectOnPage(
        released.pageDiv,
        released.startX,
        released.startY,
        endX,
        endY
      )
      const quote = textInClientRect(released.pageDiv, clientRect)
      addArea(viewer, released.pageDiv, clientRect, quote, released.append)
    }

    let hoveredRun: Element | null = null
    const handleHover = (event: PointerEvent): void => {
      if (drag) {
        return
      }
      const target =
        event.target instanceof Element ? event.target.closest(TEXT_RUN_SELECTOR) : null
      const run = target && container.contains(target) ? target : null
      // Why: skip re-rendering the viewer for moves that stay over the same run.
      if (run === hoveredRun) {
        return
      }
      hoveredRun = run
      const box = run ? paragraphAt(run)?.rect : undefined
      setHoverRect(
        box
          ? contentRectBetween(
              container,
              { x: box.left, y: box.top },
              { x: box.right, y: box.bottom }
            )
          : null
      )
    }

    const handleDragMove = (event: PointerEvent): void => {
      if (drag) {
        const rect = dragRectOnPage(
          drag.pageDiv,
          drag.startX,
          drag.startY,
          event.clientX,
          event.clientY
        )
        setDragRect(
          contentRectBetween(
            container,
            { x: rect.left, y: rect.top },
            { x: rect.right, y: rect.bottom }
          )
        )
      }
    }

    const endDrag = (): Drag | null => {
      const released = drag
      drag = null
      setDragRect(null)
      window.removeEventListener('pointermove', handleDragMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', endDrag)
      return released
    }

    const handlePointerUp = (event: PointerEvent): void => {
      const released = endDrag()
      const viewer = pdfViewerRef.current
      if (!released || !viewer) {
        return
      }
      const moved = Math.hypot(event.clientX - released.startX, event.clientY - released.startY)
      if (moved >= DRAG_THRESHOLD_PX) {
        finishRegion(viewer, released, event.clientX, event.clientY)
      } else if (event.target instanceof Element) {
        finishClick(viewer, event.target, event.clientX, event.clientY, released.append)
      }
    }

    const handlePointerDown = (event: PointerEvent): void => {
      if (event.button !== 0) {
        return
      }
      // Without Shift, a press while the card is open just dismisses it (Radix handles that).
      const append = event.shiftKey && pendingRef.current !== null
      if (pendingRef.current && !append) {
        return
      }
      const pageDiv =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>('.page[data-page-number]')
          : null
      if (!pageDiv) {
        return
      }
      // Why: pdf.js text selection scatters over math; a box drag replaces it while annotating.
      event.preventDefault()
      endDrag()
      drag = { pageDiv, startX: event.clientX, startY: event.clientY, append }
      hoveredRun = null
      setHoverRect(null)
      window.addEventListener('pointermove', handleDragMove)
      window.addEventListener('pointerup', handlePointerUp)
      // An OS gesture or window switch cancels the pointer; drop the half-drawn box.
      window.addEventListener('pointercancel', endDrag)
    }

    // Why: a link click while annotating would navigate away from the spot being commented on.
    const handleClickCapture = (event: MouseEvent): void => {
      if (event.target instanceof Element && event.target.closest('a[href]')) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (!pendingRef.current && isAnnotateModeExitKey(event, container)) {
        stop()
      }
    }
    container.addEventListener('pointerdown', handlePointerDown)
    container.addEventListener('pointermove', handleHover)
    container.addEventListener('click', handleClickCapture, true)
    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      container.removeEventListener('pointerdown', handlePointerDown)
      container.removeEventListener('pointermove', handleHover)
      container.removeEventListener('click', handleClickCapture, true)
      window.removeEventListener('keydown', handleKeyDown, true)
      endDrag()
    }
  }, [active, fileKey, containerRef, pdfViewerRef, stop])

  const toggle = useCallback((): void => {
    if (active) {
      stop()
    } else {
      setArmedFileKey(fileKey)
    }
  }, [active, fileKey, stop])

  const add = useCallback(
    (comment: string, intent: BrowserAnnotationIntent): void => {
      if (!pending || !fileKey) {
        return
      }
      addPdfAnnotation({
        id: `pdf-annotation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        fileKey,
        page: pending.page,
        x: pending.x,
        y: pending.y,
        regions: pending.regions,
        quote: pending.quote,
        comment,
        intent,
        createdAt: new Date().toISOString()
      })
      // Stay armed after adding, as Design Mode rearms its picker.
      setPending(null)
    },
    [addPdfAnnotation, fileKey, pending]
  )

  const cancel = useCallback((): void => setPending(null), [])

  const { markers, pendingRegions, pendingAnchor } = projectPdfAnnotations(
    pdfViewerRef.current,
    containerRef.current,
    annotations,
    pending
  )

  return {
    enabled: context !== null,
    surface,
    setSurface,
    active,
    toggle,
    annotations,
    markers,
    hoverRect: active && !pending && !dragRect ? hoverRect : null,
    dragRect,
    pending,
    pendingRegions,
    pendingAnchor,
    add,
    cancel
  }
}

export type PdfAnnotateMode = ReturnType<typeof usePdfAnnotateMode>
