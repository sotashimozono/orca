import { describe, expect, it } from 'vitest'
import { snapToWords } from './pdf-text-layer-text'

function pick(text: string, from: number, to: number): string {
  const chars = [...text]
  return snapToWords(
    chars,
    chars.map((_, index) => index >= from && index < to)
  )
}

describe('snapToWords', () => {
  it('widens a box edge that cut a Latin word to the whole word', () => {
    // Picks "his is the fi" -> "This is the first".
    expect(pick('This is the first line', 1, 14)).toBe('This is the first')
  })

  it('keeps indexes aligned after an astral math glyph', () => {
    const text = 'let 𝑥 be the value'
    const start = [...text].indexOf('b')
    expect(pick(text, start, start + 6)).toBe('be the')
  })

  it('does not widen CJK, which has no word spaces', () => {
    expect(pick('これは本文です', 2, 4)).toBe('は本')
  })
})
