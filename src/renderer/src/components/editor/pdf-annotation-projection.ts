import type { PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs'
import type { PdfAnnotation, PdfRegion } from '@/store/slices/pdf-annotations'
import {
  pageRightContentX,
  pdfPointToContentPoint,
  pdfRegionToContentRect,
  type PdfPagePoint
} from './pdf-page-geometry'
import type { PdfContentRect } from './pdf-text-layer-text'

/**
 * Where annotations and the draft sit in the scroll container's content box right now.
 * Re-run after zoom: positions come from live pdf.js page geometry.
 */
export function projectPdfAnnotations(
  viewer: PDFViewer | null,
  container: HTMLElement | null,
  annotations: readonly PdfAnnotation[],
  pending: (PdfPagePoint & { regions: PdfRegion[] }) | null
) {
  const project = (point: PdfPagePoint): { x: number; y: number } | null =>
    viewer && container ? pdfPointToContentPoint(viewer, container, point) : null
  const projectRegion = (region: PdfRegion): PdfContentRect | null =>
    viewer && container ? pdfRegionToContentRect(viewer, container, region) : null
  const markers = annotations.flatMap((annotation, index) => {
    const position = project(annotation)
    const regions = annotation.regions.flatMap((region) => projectRegion(region) ?? [])
    return position ? [{ id: annotation.id, index, ...position, regions }] : []
  })
  const pendingRegions = pending?.regions.flatMap((region) => projectRegion(region) ?? []) ?? []
  // Why: the card opens in the gutter past the page's right edge, level with the draft's top,
  // so it never covers text the reader may Shift+click or Shift+drag next.
  const pageRight =
    pending && viewer && container ? pageRightContentX(viewer, container, pending.page) : null
  const draftTop =
    pendingRegions.length > 0 ? Math.min(...pendingRegions.map((rect) => rect.y)) : null
  const pinPoint = pending ? project(pending) : null
  const pendingAnchor =
    pageRight === null ? pinPoint : { x: pageRight, y: draftTop ?? pinPoint?.y ?? 0 }
  return { markers, pendingRegions, pendingAnchor }
}
