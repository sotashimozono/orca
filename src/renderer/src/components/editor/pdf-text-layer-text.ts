/** A rect in the scroll container's content box, so overlays scroll with the pages. */
export type PdfContentRect = { x: number; y: number; width: number; height: number }

/** Client point inside the scroll container's content box, so overlays scroll with the pages. */
export function clientToContentPoint(
  container: HTMLElement,
  clientX: number,
  clientY: number
): { x: number; y: number } {
  const rect = container.getBoundingClientRect()
  return {
    x: clientX - rect.left + container.scrollLeft,
    y: clientY - rect.top + container.scrollTop
  }
}

/** pdf.js text-layer runs; markedContent spans are structural wrappers without their own text. */
export const TEXT_RUN_SELECTOR = '.textLayer span:not(.markedContent)'

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function contentRectBetween(
  container: HTMLElement,
  a: { x: number; y: number },
  b: { x: number; y: number }
): PdfContentRect {
  const start = clientToContentPoint(container, Math.min(a.x, b.x), Math.min(a.y, b.y))
  return { ...start, width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) }
}

/** Same "covers half" rule as SyncTeX line picking, so the quote matches the reported lines. */
function coversGlyph(glyph: DOMRect, rect: DOMRect): boolean {
  const cx = glyph.left + glyph.width / 2
  const overlapY = Math.min(glyph.bottom, rect.bottom) - Math.max(glyph.top, rect.top)
  return cx >= rect.left && cx <= rect.right && overlapY >= glyph.height / 2
}

// Latin-script word characters only; CJK has no spaces, so snapping would swallow whole sentences.
const WORD_CHAR_RE = /[A-Za-z0-9\u00C0-\u024F]/

/**
 * Widens each picked span to whole words where the box edge cut a word in half.
 * `chars` are code points, so astral glyphs (e.g. math italic 𝑥) keep indexes aligned.
 */
export function snapToWords(chars: readonly string[], picked: readonly boolean[]): string {
  const snapped = [...picked]
  chars.forEach((char, index) => {
    if (!picked[index] || !WORD_CHAR_RE.test(char)) {
      return
    }
    for (let left = index - 1; left >= 0 && WORD_CHAR_RE.test(chars[left]); left -= 1) {
      snapped[left] = true
    }
    for (
      let right = index + 1;
      right < chars.length && WORD_CHAR_RE.test(chars[right]);
      right += 1
    ) {
      snapped[right] = true
    }
  })
  return chars.filter((_, index) => snapped[index]).join('')
}

// Why: a run is often a whole line, so a box around one word must be cut per character.
function runTextInRect(run: Element, rect: DOMRect): string {
  const node = run.firstChild
  const text = node?.textContent ?? ''
  if (!(node instanceof Text) || text.length === 0) {
    return coversGlyph(run.getBoundingClientRect(), rect) ? text : ''
  }
  const range = document.createRange()
  const chars = [...text]
  const picked: boolean[] = []
  let offset = 0
  for (const char of chars) {
    range.setStart(node, offset)
    range.setEnd(node, offset + char.length)
    picked.push(coversGlyph(range.getBoundingClientRect(), rect))
    offset += char.length
  }
  return snapToWords(chars, picked)
}

/** Text under a client rect, in text-layer order. Math may come out garbled. */
export function textInClientRect(pageDiv: HTMLElement, rect: DOMRect): string | null {
  const parts: string[] = []
  for (const run of pageDiv.querySelectorAll(TEXT_RUN_SELECTOR)) {
    const box = run.getBoundingClientRect()
    if (
      box.right < rect.left ||
      box.left > rect.right ||
      box.bottom < rect.top ||
      box.top > rect.bottom
    ) {
      continue
    }
    const text = runTextInRect(run, rect).trim()
    if (text) {
      parts.push(text)
    }
  }
  return parts.length > 0 ? parts.join(' ') : null
}

export function joinQuotes(a: string | null, b: string | null): string | null {
  return a && b ? `${a} … ${b}` : (a ?? b)
}
