import { useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import { buildPdfJsDocumentOptions } from './pdf-js-document-options'

type PdfLoadingTask = ReturnType<typeof pdfjsLib.getDocument>

export type LoadedPdf = {
  doc: Awaited<PdfLoadingTask['promise']>
  /** Owned by the caller once handed over: destroying it tears down `doc`. */
  task: PdfLoadingTask
  filePath: string
}

function decodeBase64Pdf(content: string): Uint8Array | null {
  let binary: string
  try {
    binary = window.atob(content)
  } catch {
    return null
  }
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/**
 * Parses PDF bytes before anything is shown, and hands over only documents that parsed.
 * A failed reload of the same file keeps the last good document on screen — a LaTeX build
 * rewrites its PDF in place, so a reload can read it half-written — while a failure on a
 * different file clears it, so one file's pages never stand in for another's.
 */
export function usePdfDocumentLoad(
  cleanedContent: string,
  filePath: string,
  scrollCacheKey: string | null
): { loaded: LoadedPdf | null; error: string | null } {
  const [loaded, setLoaded] = useState<LoadedPdf | null>(null)
  const [error, setError] = useState<string | null>(null)
  const loadedRef = useRef<LoadedPdf | null>(null)

  useEffect(() => {
    loadedRef.current = loaded
  }, [loaded])

  useEffect(() => {
    if (!cleanedContent) {
      return
    }
    let cancelled = false
    const fail = (message: string): void => {
      if (loadedRef.current?.filePath === filePath) {
        return
      }
      setLoaded(null)
      setError(message)
    }
    const bytes = decodeBase64Pdf(cleanedContent)
    if (!bytes) {
      fail('Failed to decode PDF content')
      return
    }
    const task = pdfjsLib.getDocument(buildPdfJsDocumentOptions(bytes, document.baseURI))
    task.promise
      .then((doc) => {
        if (cancelled) {
          task.destroy().catch(() => {})
          return
        }
        setError(null)
        setLoaded({ doc, task, filePath })
      })
      .catch((err) => {
        task.destroy().catch(() => {})
        if (cancelled) {
          return
        }
        fail(
          err?.name === 'PasswordException'
            ? 'This PDF is password-protected'
            : 'Failed to load PDF preview'
        )
      })
    return () => {
      cancelled = true
    }
    // Why: scrollCacheKey because two distinct paths can hold identical bytes — the
    // second file must get its own document so its scroll position is restored, not the first's.
  }, [cleanedContent, filePath, scrollCacheKey])

  return { loaded, error }
}
