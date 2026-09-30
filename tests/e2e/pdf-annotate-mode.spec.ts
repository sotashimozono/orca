import { rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { createPdfFindFixture } from './helpers/pdf-find-fixture'

// The fixture's pages are US Letter; text starts at x=60 with baselines 92, 132, 172, 212
// PDF points below the top edge (20pt Helvetica, 40pt leading).
const PAGE_WIDTH_PT = 612

async function pdfToClient(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const box = await page.locator('.pdfViewer .page[data-page-number="1"]').boundingBox()
  if (!box) {
    throw new Error('PDF page is not laid out')
  }
  const scale = box.width / PAGE_WIDTH_PT
  return { x: box.x + x * scale, y: box.y + y * scale }
}

async function dragPdfBox(
  page: Page,
  [left, top, right, bottom]: [number, number, number, number],
  { shift = false } = {}
): Promise<void> {
  const from = await pdfToClient(page, left, top)
  const to = await pdfToClient(page, right, bottom)
  if (shift) {
    await page.keyboard.down('Shift')
  }
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 6 })
  await page.mouse.up()
  if (shift) {
    await page.keyboard.up('Shift')
  }
}

test('PDF annotate mode: box, Shift+drag areas and pins reach the agent prompt', async ({
  orcaPage,
  electronApp,
  seededRepoPath,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  const filePath = path.join(seededRepoPath, 'pdf-annotate-fixture.pdf')
  writeFileSync(filePath, createPdfFindFixture())
  registerPostElectronShutdownCleanup(async () => rmSync(filePath, { force: true }))
  // Why: the host OS locale drives the UI language; pin English so locators are stable.
  await orcaPage.evaluate(() =>
    window.__store!.getState().updateSettings({ uiLanguage: 'en', theme: 'light' })
  )
  await orcaPage.evaluate((filePath) => {
    const state = window.__store?.getState()
    if (!state?.activeWorktreeId) {
      throw new Error('Missing fixture worktree')
    }
    state.openFile({
      filePath,
      relativePath: 'pdf-annotate-fixture.pdf',
      worktreeId: state.activeWorktreeId,
      language: 'plaintext',
      mode: 'edit'
    })
  }, filePath)
  await expect(orcaPage.locator('.pdfViewer .page').first().locator('.textLayer')).toContainText(
    'needle result 1'
  )
  const shot = (name: string) => orcaPage.screenshot({ path: testInfo.outputPath(`${name}.png`) })
  const annotate = orcaPage.getByRole('button', { name: 'Annotate PDF' })
  const card = orcaPage.getByRole('dialog', { name: 'Add PDF annotation' })
  const badges = orcaPage.locator('[data-pdf-annotation-badge]')

  await annotate.click()
  await expect(annotate).toHaveAttribute('aria-pressed', 'true')

  await dragPdfBox(orcaPage, [55, 112, 260, 138])
  await expect(card).toContainText('p.1 "needle result 1"')
  await dragPdfBox(orcaPage, [55, 152, 260, 178], { shift: true })
  await expect(card).toContainText('p.1 (2 areas) "needle result 1 … needle result 2"')
  await expect(card).toHaveCSS('opacity', '1')
  await shot('01-two-areas-pending')
  await card.getByRole('textbox').fill('Merge these two results')
  await card.getByRole('button', { name: /Add/ }).click()
  await expect(card).toHaveCount(0)
  await expect(orcaPage.getByText('1 annotation', { exact: true })).toBeVisible()
  // Annotate mode stays armed after adding, like Design Mode.
  await expect(annotate).toHaveAttribute('aria-pressed', 'true')

  const pin = await pdfToClient(orcaPage, 90, 205)
  await orcaPage.mouse.click(pin.x, pin.y)
  await expect(card).toContainText('beacon alternate query')
  await card.getByRole('textbox').fill('Rename the query')
  await card.getByRole('button', { name: /Add/ }).click()
  await expect(orcaPage.getByText('2 annotations', { exact: true })).toBeVisible()
  await expect(badges).toHaveText(['1', '2'])
  await shot('02-two-annotations')

  await orcaPage.getByRole('button', { name: 'Copy' }).click()
  const prompt = await electronApp.evaluate(({ clipboard }) => clipboard.readText())
  writeFileSync(testInfo.outputPath('prompt.md'), prompt)
  expect(prompt).toContain('## PDF Feedback: pdf-annotate-fixture.pdf')
  expect(prompt).toContain('**Text in areas (approximate):** "needle result 1 … needle result 2"')
  expect(prompt).toContain('**Feedback:** Merge these two results')
  expect(prompt).toContain('**Text:** "beacon alternate query"')

  const before = await badges.first().boundingBox()
  await orcaPage.getByTitle('Zoom in').click()
  await expect.poll(async () => (await badges.first().boundingBox())?.y).not.toBe(before?.y)
  await shot('03-zoomed')

  // Visual proof only: the overlay uses theme tokens, so dark mode needs no separate logic.
  await orcaPage.evaluate(() => window.__store!.getState().updateSettings({ theme: 'dark' }))
  await expect(orcaPage.locator('html')).toHaveClass(/dark/)
  await dragPdfBox(orcaPage, [55, 112, 260, 138])
  await expect(card).toHaveCSS('opacity', '1')
  await shot('04-dark-pending')
  await card.getByRole('button', { name: 'Cancel' }).click()

  await orcaPage.keyboard.press('Escape')
  await expect(annotate).toHaveAttribute('aria-pressed', 'false')

  const windows = await electronApp.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((window) => ({
      visible: window.isVisible(),
      focused: window.isFocused()
    }))
  )
  expect(windows.every((window) => !window.focused)).toBe(true)
})
