// The tools, used the way a person would: pick a tool, add files, set the
// options, convert, download. The downloads are checked with PDFKit.
const { test, expect } = require('./fixtures');
const { openApp, pickTool, addFiles, fileNames, resultNames, convert, download } = require('./helpers');
const { info, engines } = require('../engines');
const { PASSWORD } = require('./sample-files');

test.beforeEach(async ({ page }) => openApp(page));

test('merge two PDFs and download the result', async ({ page }) => {
  await addFiles(page, ['three-pages.pdf', 'two-pages.pdf']);
  await convert(page);
  await expect(page.locator('#status')).toHaveText(/Done: 1 file/);
  expect(await resultNames(page)).toEqual(['three-pages-merged.pdf']);
  const file = await download(page, 'three-pages-merged.pdf');
  expect((await info(file)).pages).toHaveLength(5);
});

test('reorder files from the keyboard before making a PDF from images', async ({ page }) => {
  await pickTool(page, 'images-to-pdf');
  await addFiles(page, ['p1.png', 'landscape.png']);
  await page.getByRole('button', { name: 'Move landscape.png up' }).focus();
  await page.keyboard.press('Enter');
  expect(await fileNames(page)).toEqual(['landscape.png', 'p1.png']);
  // Focus stays on the moved file, on the arrow that can still be used.
  await expect(page.getByRole('button', { name: 'Move landscape.png down' })).toBeFocused();

  await page.locator('#pageSizeSelect').selectOption('a4');
  await convert(page);
  const file = await download(page, 'landscape.pdf');
  expect((await info(file)).pages.map((p) => p.size)).toEqual([[842, 595], [595, 842]]);
});

test('split by page ranges', async ({ page }) => {
  await pickTool(page, 'split');
  await addFiles(page, ['three-pages.pdf']);
  await page.locator('#rangesInput').fill('1-2, 3');
  await convert(page);
  expect(await resultNames(page)).toEqual(['three-pages-pages-1-2.pdf', 'three-pages-page-3.pdf']);
  await expect(page.locator('#downloadAllButton')).toBeVisible();
});

test('a wrong page range explains what to fix', async ({ page }) => {
  await pickTool(page, 'split');
  await addFiles(page, ['three-pages.pdf']);
  await page.locator('#rangesInput').fill('2-9');
  await convert(page);
  await expect(page.locator('#status')).toHaveText(/Check the pages: .*2-9/);
  await expect(page.locator('#results')).toBeHidden();
});

test('PDF pages to JPEG images', async ({ page }) => {
  await pickTool(page, 'pdf-to-images');
  await addFiles(page, ['two-pages.pdf']);
  await page.locator('#formatSelect').selectOption('jpeg');
  await page.locator('#dpiInput').fill('72');
  await convert(page);
  expect(await resultNames(page)).toEqual(['two-pages-page-1.jpg', 'two-pages-page-2.jpg']);
});

test('rotate a PDF', async ({ page }) => {
  await pickTool(page, 'rotate');
  await addFiles(page, ['two-pages.pdf']);
  await page.locator('#degreesSelect').selectOption('180');
  await convert(page);
  const file = await download(page, 'two-pages-rotated.pdf');
  expect((await info(file)).pages.map((p) => p.rotation)).toEqual([180, 180]);
});

test('remove the password from a PDF', async ({ page }) => {
  await pickTool(page, 'unlock');
  await addFiles(page, ['protected.pdf']);
  await page.locator('#passwordInput').fill('wrong');
  await convert(page);
  await expect(page.locator('#status')).toHaveText('Wrong password.');

  await page.locator('#passwordInput').fill(PASSWORD);
  await convert(page);
  const file = await download(page, 'protected-unlocked.pdf');
  expect((await info(file)).encrypted).toBe(false);
});

test('files a tool can\'t use are marked, and nothing runs', async ({ page }) => {
  await addFiles(page, ['three-pages.pdf', 'notes.txt']);
  await expect(page.locator('#fileList li.invalid')).toHaveText(/notes\.txt.*Can't be used with this tool/);
  await convert(page);
  await expect(page.locator('#status')).toHaveText(/can't be used with this tool/);

  await page.getByRole('button', { name: 'Remove notes.txt' }).click();
  expect(await fileNames(page)).toEqual(['three-pages.pdf']);
  await convert(page);
  await expect(page.locator('#status')).toHaveText('Add at least 2 files for this tool.');
});

test.describe('without qpdf, on macOS', () => {
  test.skip(() => !engines().pdfkit, 'only PDFKit can protect a PDF without qpdf');
  test.use({ serverEnv: { SHIFTDECK_DISABLE_ENGINES: 'qpdf' } });

  test('adding a password warns that the encryption is weak', async ({ page }) => {
    await pickTool(page, 'protect');
    await expect(page.locator('#weakNotice')).toBeVisible();
    await expect(page.locator('#weakNotice')).toContainText('npm run setup');
    await addFiles(page, ['two-pages.pdf']);

    await convert(page);
    await expect(page.locator('#status')).toHaveText('Type a password.');

    await page.locator('#passwordInput').fill(PASSWORD);
    await page.getByLabel('Show password').check();
    await expect(page.locator('#passwordInput')).toHaveAttribute('type', 'text');
    await convert(page);
    await expect(page.locator('#status')).toContainText('RC4 128-bit');
    const file = await download(page, 'two-pages-protected.pdf');
    expect((await info(file)).locked).toBe(true);
  });
});

test.describe('with qpdf', () => {
  test.skip(() => !engines().qpdf, 'qpdf is not installed');

  test('adding a password uses AES-256', async ({ page }) => {
    await pickTool(page, 'protect');
    await expect(page.locator('#strongNotice')).toBeVisible();
    await expect(page.locator('#weakNotice')).toBeHidden();
    await addFiles(page, ['two-pages.pdf']);
    await page.locator('#passwordInput').fill(PASSWORD);
    await convert(page);
    await expect(page.locator('#status')).toHaveText('Done: 1 file ready.');
  });
});
