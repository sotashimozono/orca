import { useCallback } from 'react'
import { useAppStore } from '@/store'
import type { OpenFile } from '@/store/slices/editor'
import {
  deriveMarkdownPreviewSourceRoot,
  resolveMarkdownPreviewSourceWorktree
} from './markdown-preview-source-routing'

/** Opens a file a PDF links to by relative path, on the host that holds the PDF. */
export function usePdfRelativeFileLinkOpener(
  file: Pick<OpenFile, 'filePath' | 'relativePath' | 'worktreeId' | 'runtimeEnvironmentId'>
): (href: string) => void {
  const activateMarkdownLink = useAppStore((s) => s.activateMarkdownLink)
  const { filePath, relativePath, worktreeId, runtimeEnvironmentId } = file
  return useCallback(
    (href: string) => {
      const worktree = resolveMarkdownPreviewSourceWorktree(
        useAppStore.getState().worktreesByRepo,
        worktreeId,
        filePath
      )
      // Why: the markdown link action already resolves against the source file,
      // stats on its owning host (local, SSH, runtime), and reports a miss.
      void activateMarkdownLink(href, {
        sourceFilePath: filePath,
        worktreeId,
        worktreeRoot: worktree?.path ?? deriveMarkdownPreviewSourceRoot(filePath, relativePath),
        runtimeEnvironmentId
      })
    },
    [activateMarkdownLink, filePath, relativePath, worktreeId, runtimeEnvironmentId]
  )
}
