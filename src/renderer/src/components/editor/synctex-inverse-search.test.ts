import { describe, expect, it } from 'vitest'
import {
  parseSynctex,
  synctexInverseSearch,
  synctexSourceRangesInRect
} from './synctex-inverse-search'

// 65781.76 sp = 1 PDF point, so coordinates below read as `points * BP`.
const BP = 65781.76

function sp(points: number): number {
  return Math.round(points * BP)
}

function synctexFile({ offset = 0, body }: { offset?: number; body: string[] }): string {
  return [
    'SyncTeX Version:1',
    'Input:1:/project/./main.tex',
    'Input:2:/project/./chapter.tex',
    'Output:pdf',
    'Magnification:1000',
    'Unit:1',
    `X Offset:${offset}`,
    `Y Offset:${offset}`,
    'Content:',
    '{1',
    ...body,
    '}1',
    'Postamble:'
  ].join('\n')
}

// One paragraph line spanning x=100..400 at baseline y=200, closed on source
// line 9, whose words came from lines 5 and 6. The leading `x` record carries
// the paragraph-end line, as TeX writes it.
const paragraphLine = [
  `[1,9:${sp(100)},${sp(300)}:${sp(300)},${sp(120)},0`,
  `(1,9:${sp(100)},${sp(200)}:${sp(300)},${sp(8)},${sp(2)}`,
  `x1,9:${sp(130)},${sp(200)}`,
  `k1,5:${sp(135)},${sp(200)}:${sp(3)}`,
  `x1,5:${sp(180)},${sp(200)}`,
  `k1,6:${sp(250)},${sp(200)}:${sp(3)}`,
  `x1,6:${sp(300)},${sp(200)}`,
  ')',
  `(2,3:${sp(100)},${sp(260)}:${sp(300)},${sp(8)},${sp(2)}`,
  `k2,3:${sp(140)},${sp(260)}:${sp(3)}`,
  ')',
  ']'
]

describe('synctexInverseSearch', () => {
  const doc = parseSynctex(synctexFile({ body: paragraphLine }))

  it('returns the line a word came from, not the paragraph-end line of its box', () => {
    expect(synctexInverseSearch(doc, 1, 110, 197)).toEqual({
      filePath: '/project/main.tex',
      line: 5
    })
    expect(synctexInverseSearch(doc, 1, 200, 197)).toEqual({
      filePath: '/project/main.tex',
      line: 5
    })
    expect(synctexInverseSearch(doc, 1, 320, 197)).toEqual({
      filePath: '/project/main.tex',
      line: 6
    })
  })

  it('resolves text from an \\input file to that file', () => {
    expect(synctexInverseSearch(doc, 1, 200, 258)).toEqual({
      filePath: '/project/chapter.tex',
      line: 3
    })
  })

  it('falls back to the nearest box for clicks between lines', () => {
    expect(synctexInverseSearch(doc, 1, 200, 250)?.filePath).toBe('/project/chapter.tex')
  })

  it('applies the X/Y Offset header that DVI-routed builds write', () => {
    const dvi = parseSynctex(
      synctexFile({
        offset: sp(72),
        body: [
          `(1,4:${sp(100 - 72)},${sp(200 - 72)}:${sp(300)},${sp(8)},${sp(2)}`,
          `k1,4:${sp(110 - 72)},${sp(200 - 72)}:${sp(3)}`,
          ')'
        ]
      })
    )
    expect(synctexInverseSearch(dvi, 1, 200, 197)).toEqual({
      filePath: '/project/main.tex',
      line: 4
    })
  })

  it('returns null for a page with no boxes', () => {
    expect(synctexInverseSearch(doc, 2, 200, 197)).toBeNull()
  })
})

describe('synctexSourceRangesInRect', () => {
  const doc = parseSynctex(synctexFile({ body: paragraphLine }))

  it('covers every line typeset inside the rect, merged per file', () => {
    expect(
      synctexSourceRangesInRect(doc, 1, { left: 100, top: 190, right: 400, bottom: 265 })
    ).toEqual([
      { filePath: '/project/main.tex', startLine: 5, endLine: 6 },
      { filePath: '/project/chapter.tex', startLine: 3, endLine: 3 }
    ])
  })

  it('credits a word to the record it started at, even with no record inside the rect', () => {
    expect(
      synctexSourceRangesInRect(doc, 1, { left: 190, top: 195, right: 240, bottom: 201 })
    ).toEqual([{ filePath: '/project/main.tex', startLine: 5, endLine: 5 }])
  })

  it('ignores a line the box only grazes', () => {
    // The main.tex line spans y=192..202; a box from y=200 down covers the chapter line only.
    expect(
      synctexSourceRangesInRect(doc, 1, { left: 100, top: 200, right: 400, bottom: 265 })
    ).toEqual([{ filePath: '/project/chapter.tex', startLine: 3, endLine: 3 }])
  })

  it('returns nothing for empty space', () => {
    expect(synctexSourceRangesInRect(doc, 1, { left: 10, top: 10, right: 50, bottom: 50 })).toEqual(
      []
    )
  })
})
