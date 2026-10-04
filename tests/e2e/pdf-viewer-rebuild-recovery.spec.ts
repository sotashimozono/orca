import { rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from './helpers/orca-app'
import { createPdfFindFixture } from './helpers/pdf-find-fixture'

// A LaTeX build rewrites its PDF in place over several seconds; the editor's
// external-change reload can pick up the half-written file before the final one.
test('PDF preview recovers when a half-written PDF is replaced by the finished one', async ({
  orcaPage,
  seededRepoPath,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  const filePath = path.join(seededRepoPath, 'rebuilt.pdf')
  const finished = createPdfFindFixture()
  writeFileSync(filePath, finished)
  registerPostElectronShutdownCleanup(async () => rmSync(filePath, { force: true }))
  await orcaPage.evaluate((filePath) => {
    const state = window.__store?.getState()
    if (!state?.activeWorktreeId) {
      throw new Error('Missing fixture worktree')
    }
    state.openFile({
      filePath,
      relativePath: 'rebuilt.pdf',
      worktreeId: state.activeWorktreeId,
      language: 'plaintext',
      mode: 'edit'
    })
  }, filePath)
  const pages = orcaPage.locator('.pdfViewer .page')
  await expect(pages).toHaveCount(3)

  writeFileSync(filePath, finished.subarray(0, Math.floor(finished.length / 2)))
  await expect(orcaPage.getByText('Failed to load PDF preview')).toBeVisible()

  writeFileSync(filePath, finished)
  // Past the 75ms reload debounce, so the screenshot shows the settled state.
  await orcaPage.waitForTimeout(1500)
  await orcaPage.screenshot({ path: testInfo.outputPath('after-finished-pdf-lands.png') })
  await expect(orcaPage.getByText('Failed to load PDF preview')).toBeHidden()
  await expect(pages).toHaveCount(3)
})
