import { PDFPageView, type PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs'
import { clientToContentPoint } from './pdf-text-layer-text'

/** 1-based page; x/y in PDF points from the page's top-left. */
export type PdfPagePoint = { page: number; x: number; y: number }

function pageViewFor(viewer: PDFViewer, page: number): PDFPageView | null {
  const pageView: unknown = viewer.getPageView(page - 1)
  return pageView instanceof PDFPageView ? pageView : null
}

/** Maps a client position over a rendered page to a PDF point on that page. */
export function pdfPagePointAt(
  viewer: PDFViewer,
  target: Element,
  clientX: number,
  clientY: number
): PdfPagePoint | null {
  const pageDiv = target.closest<HTMLElement>('.page[data-page-number]')
  const page = Number(pageDiv?.dataset.pageNumber)
  const pageView = pageDiv && Number.isInteger(page) && page >= 1 ? pageViewFor(viewer, page) : null
  if (!pageDiv || !pageView) {
    return null
  }
  const rect = pageDiv.getBoundingClientRect()
  const [pdfX, pdfY] = pageView.viewport.convertToPdfPoint(clientX - rect.left, clientY - rect.top)
  const [xMin, , , yMax] = pageView.viewport.viewBox
  // PDF user space is bottom-up; annotations measure down from the top edge.
  return { page, x: Number(pdfX) - xMin, y: yMax - Number(pdfY) }
}

/** Position of a PDF point inside the scroll container's content box, so overlays scroll natively. */
export function pdfPointToContentPoint(
  viewer: PDFViewer,
  container: HTMLElement,
  point: PdfPagePoint
): { x: number; y: number } | null {
  const pageView = pageViewFor(viewer, point.page)
  if (!pageView) {
    return null
  }
  const [xMin, , , yMax] = pageView.viewport.viewBox
  const [vx, vy] = pageView.viewport.convertToViewportPoint(point.x + xMin, yMax - point.y)
  const pageRect = pageView.div.getBoundingClientRect()
  return clientToContentPoint(container, pageRect.left + Number(vx), pageRect.top + Number(vy))
}

/** A PDF-point box on one page, projected into the scroll container's content box. */
export function pdfRegionToContentRect(
  viewer: PDFViewer,
  container: HTMLElement,
  region: { page: number; left: number; top: number; right: number; bottom: number }
): { x: number; y: number; width: number; height: number } | null {
  const topLeft = pdfPointToContentPoint(viewer, container, {
    page: region.page,
    x: region.left,
    y: region.top
  })
  const bottomRight = pdfPointToContentPoint(viewer, container, {
    page: region.page,
    x: region.right,
    y: region.bottom
  })
  return topLeft && bottomRight
    ? { ...topLeft, width: bottomRight.x - topLeft.x, height: bottomRight.y - topLeft.y }
    : null
}

/** A client rect over one page as a PDF-point box on that page. */
export function pdfRegionFromClientRect(
  viewer: PDFViewer,
  pageDiv: Element,
  rect: DOMRect
): { page: number; left: number; top: number; right: number; bottom: number } | null {
  const a = pdfPagePointAt(viewer, pageDiv, rect.left, rect.top)
  const b = pdfPagePointAt(viewer, pageDiv, rect.right, rect.bottom)
  if (!a || !b) {
    return null
  }
  return {
    page: a.page,
    left: Math.min(a.x, b.x),
    top: Math.min(a.y, b.y),
    right: Math.max(a.x, b.x),
    bottom: Math.max(a.y, b.y)
  }
}
