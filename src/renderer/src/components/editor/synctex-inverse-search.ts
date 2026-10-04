// SyncTeX inverse search (PDF position → source line), parsed in JS so SSH and
// runtime hosts need no `synctex` binary. Format: synctex_parser.c in TeX Live.

type SynctexLink = { tag: number; line: number }

// `current` = an `x` record; TeX stamps it with the paragraph-end line at line starts.
type SynctexRecord = SynctexLink & { x: number; current: boolean }

type SynctexHBox = SynctexLink & {
  left: number
  right: number
  top: number
  bottom: number
  records: SynctexRecord[]
}

export type SynctexDocument = {
  inputs: Map<number, string>
  pages: Map<number, SynctexHBox[]>
}

export type SynctexSourceLocation = { filePath: string; line: number }

// sp → PDF big points (72.27 TeX pt per 72 bp).
const SP_PER_BP = 65781.76

// The second coordinate may be `=`: a compressed point that repeats the last full one's.
const LINK_RE = /^(\d+),(-?\d+)(?:,-?\d+)?:(-?\d+),(-?\d+|=)(?::(-?\d+),(-?\d+),(-?\d+))?/

type ParsedLine = SynctexLink & {
  x: number
  y: number
  width: number
  height: number
  depth: number
}

/** `xOffset`/`yOffset` are already in PDF points: synctex_parser.c does not magnify them. */
type Frame = { scale: number; xOffset: number; yOffset: number; lastRawY: number }

function parseLinkLine(body: string, frame: Frame): ParsedLine | null {
  const match = LINK_RE.exec(body)
  if (!match) {
    return null
  }
  const rawY = match[4] === '=' ? frame.lastRawY : Number(match[4])
  frame.lastRawY = rawY
  const { scale } = frame
  return {
    tag: Number(match[1]),
    line: Number(match[2]),
    x: Number(match[3]) * scale + frame.xOffset,
    y: rawY * scale + frame.yOffset,
    width: Number(match[5] ?? 0) * scale,
    height: Number(match[6] ?? 0) * scale,
    depth: Number(match[7] ?? 0) * scale
  }
}

/** The last value wins, so a `Post scriptum:` entry overrides the preamble's. */
function readHeaderNumber(text: string, key: string, fallback: number): number {
  const last = [...text.matchAll(new RegExp(`^${key}:(-?[\\d.]+)`, 'gm'))].at(-1)
  return last ? Number(last[1]) : fallback
}

export function parseSynctex(text: string): SynctexDocument {
  const magnification = readHeaderNumber(text, 'Magnification', 1000)
  const unit = readHeaderNumber(text, 'Unit', 1)
  // Why: DVI-routed builds (upLaTeX + dvipdfmx) store coordinates relative to
  // TeX's 1in origin and put that 1in in the X/Y Offset header.
  const frame: Frame = {
    scale: (unit * magnification) / 1000 / SP_PER_BP,
    xOffset: (readHeaderNumber(text, 'X Offset', 0) * unit) / SP_PER_BP,
    yOffset: (readHeaderNumber(text, 'Y Offset', 0) * unit) / SP_PER_BP,
    lastRawY: 0
  }

  const inputs = new Map<number, string>()
  const pages = new Map<number, SynctexHBox[]>()
  let currentPage: SynctexHBox[] | null = null
  // Records attach to the innermost open hbox; vboxes push null so their direct
  // children (between lines) are not credited to an enclosing hbox.
  const boxStack: (SynctexHBox | null)[] = []

  for (const rawLine of text.split('\n')) {
    const kind = rawLine.charAt(0)
    const body = rawLine.slice(1)
    if (rawLine.startsWith('Input:')) {
      const match = /^Input:(\d+):(.*)$/.exec(rawLine)
      if (match) {
        // Why: TeX writes `dir/./file.tex`; collapse it so the path matches editor tabs.
        inputs.set(Number(match[1]), match[2].replace(/([/\\])\.(?=[/\\])/g, ''))
      }
      continue
    }
    if (kind === '{') {
      currentPage = []
      pages.set(Number(body), currentPage)
      boxStack.length = 0
      continue
    }
    if (kind === '}') {
      currentPage = null
      continue
    }
    if (!currentPage) {
      continue
    }
    if (kind === ')' || kind === ']') {
      boxStack.pop()
      continue
    }
    const parsed = parseLinkLine(body, frame)
    if (!parsed) {
      // Why: an opener we cannot read still has a closer; keep the stack in step with it.
      if (kind === '(' || kind === '[') {
        boxStack.push(null)
      }
      continue
    }
    if (kind === '(') {
      const box: SynctexHBox = {
        tag: parsed.tag,
        line: parsed.line,
        left: parsed.x,
        right: parsed.x + parsed.width,
        top: parsed.y - parsed.height,
        bottom: parsed.y + parsed.depth,
        records: []
      }
      currentPage.push(box)
      boxStack.push(box)
      continue
    }
    if (kind === '[') {
      boxStack.push(null)
      continue
    }
    // Why: `h`/`v` are void boxes (leaves), not the text a word came from.
    if (kind === 'x' || kind === 'k' || kind === 'g' || kind === '$') {
      boxStack
        .at(-1)
        ?.records.push({ tag: parsed.tag, line: parsed.line, x: parsed.x, current: kind === 'x' })
    }
  }
  return { inputs, pages }
}

function distanceToBox(box: SynctexHBox, x: number, y: number): number {
  const dx = Math.max(box.left - x, 0, x - box.right)
  const dy = Math.max(box.top - y, 0, y - box.bottom)
  return Math.hypot(dx, dy)
}

function pickHBox(boxes: SynctexHBox[], x: number, y: number): SynctexHBox | null {
  let best: SynctexHBox | null = null
  let bestDistance = Infinity
  let bestArea = Infinity
  for (const box of boxes) {
    const distance = distanceToBox(box, x, y)
    const area = (box.right - box.left) * (box.bottom - box.top)
    // Prefer containing boxes (distance 0), then the tightest one.
    if (distance < bestDistance || (distance === bestDistance && area < bestArea)) {
      best = box
      bestDistance = distance
      bestArea = area
    }
  }
  return best
}

function pickNearestRecord(records: SynctexRecord[], x: number): SynctexRecord | null {
  let before: SynctexRecord | null = null
  let after: SynctexRecord | null = null
  for (const record of records) {
    if (record.x <= x) {
      if (!before || record.x >= before.x) {
        before = record
      }
    } else if (!after || record.x < after.x) {
      after = record
    }
  }
  return before ?? after
}

function pickLink(box: SynctexHBox, x: number): SynctexLink {
  // Why: an hbox carries the line where TeX closed the paragraph; kern/glue/math
  // records inside it carry the line each word actually came from.
  return pickNearestRecord(preciseRecords(box), x) ?? box
}

/** `page` is 1-based; `x`/`y` are PDF points from the page's top-left. */
export function synctexInverseSearch(
  doc: SynctexDocument,
  page: number,
  x: number,
  y: number
): SynctexSourceLocation | null {
  const boxes = doc.pages.get(page)
  if (!boxes || boxes.length === 0) {
    return null
  }
  const box = pickHBox(boxes, x, y)
  if (!box) {
    return null
  }
  const link = pickLink(box, x)
  const filePath = doc.inputs.get(link.tag)
  if (!filePath || link.line <= 0) {
    return null
  }
  return { filePath, line: link.line }
}

export type SynctexSourceRange = { filePath: string; startLine: number; endLine: number }

/** PDF points from the page's top-left. */
export type SynctexRect = { left: number; top: number; right: number; bottom: number }

function preciseRecords(box: SynctexHBox): SynctexRecord[] {
  const precise = box.records.filter((record) => !record.current)
  return precise.length > 0 ? precise : box.records
}

/** Every source line whose typeset material falls inside `rect`, merged per file. */
export function synctexSourceRangesInRect(
  doc: SynctexDocument,
  page: number,
  rect: SynctexRect
): SynctexSourceRange[] {
  const ranges = new Map<number, { startLine: number; endLine: number }>()
  const fallback: SynctexLink[] = []
  const add = (link: SynctexLink): void => {
    if (link.line <= 0) {
      return
    }
    const range = ranges.get(link.tag)
    ranges.set(link.tag, {
      startLine: Math.min(range?.startLine ?? link.line, link.line),
      endLine: Math.max(range?.endLine ?? link.line, link.line)
    })
  }
  for (const box of doc.pages.get(page) ?? []) {
    const overlapY = Math.min(box.bottom, rect.bottom) - Math.max(box.top, rect.top)
    // Why: a hand-drawn box grazes the descenders above and ascenders below; a line
    // counts only when the box covers half of it (or half the box, for a thin box).
    const coversY =
      overlapY > 0 &&
      overlapY >= 0.5 * Math.min(box.bottom - box.top || Infinity, rect.bottom - rect.top)
    if (!coversY || box.left >= rect.right || box.right <= rect.left) {
      continue
    }
    const records = preciseRecords(box)
    if (records.length === 0) {
      fallback.push(box)
      continue
    }
    // The word under the rect's left edge started at the last record before it.
    const leading = pickNearestRecord(records, rect.left)
    if (leading) {
      add(leading)
    }
    for (const record of records) {
      if (record.x >= rect.left && record.x <= rect.right) {
        add(record)
      }
    }
  }
  // Why: record-less boxes carry only their closing line (often \end{document}), so they
  // are a last resort for rects over rules or images rather than extra noise.
  if (ranges.size === 0) {
    fallback.forEach(add)
  }
  return [...ranges].flatMap(([tag, range]) => {
    const filePath = doc.inputs.get(tag)
    return filePath ? [{ filePath, ...range }] : []
  })
}
