// The tools, used the way a person would: pick a tool, add files, set the
// options, convert, download. The downloads are checked with PDFKit.
const fs = require('fs');
const { test, expect } = require('./fixtures');
const { openApp, pickTool, addFiles, fileNames, resultNames, convert, download } = require('./helpers');
const { info, engines } = require('../engines');
const { readZip } = require('../lib/zip');
const { PASSWORD, darkPixels } = require('./sample-files');

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

test('split by page ranges, then download every part as one ZIP', async ({ page }) => {
  await pickTool(page, 'split');
  await addFiles(page, ['three-pages.pdf']);
  await page.locator('#rangesInput').fill('1-2, 3');
  await convert(page);
  expect(await resultNames(page)).toEqual(['three-pages-pages-1-2.pdf', 'three-pages-page-3.pdf']);

  const started = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download all (ZIP)' }).click();
  const zip = await started;
  expect(zip.suggestedFilename()).toBe('three-pages-split.zip');
  const saved = test.info().outputPath('parts.zip');
  await zip.saveAs(saved);
  const files = readZip(fs.readFileSync(saved));
  expect(Object.keys(files)).toEqual(['three-pages-pages-1-2.pdf', 'three-pages-page-3.pdf']);
  const part = test.info().outputPath('part.pdf');
  fs.writeFileSync(part, files['three-pages-pages-1-2.pdf']);
  expect((await info(part)).pages).toHaveLength(2);
});

test('a single result has no ZIP link', async ({ page }) => {
  await addFiles(page, ['three-pages.pdf', 'two-pages.pdf']);
  await convert(page);
  await expect(page.locator('#results')).toBeVisible();
  await expect(page.locator('#downloadAllLink')).toBeHidden();
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

test('organize pages: move, turn and remove pages, from the keyboard and by dragging', async ({ page }) => {
  await pickTool(page, 'organize');
  await addFiles(page, ['mixed.pdf']);
  await expect(page.locator('.page-card')).toHaveCount(3);
  await expect(page.locator('#pagesStatus')).toHaveText('3 of 3 pages kept.');

  // Keyboard: page 2 first, page 1 turned right, page 3 removed.
  await page.getByRole('button', { name: 'Move page 2 earlier' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#status')).toHaveText('Page 2 moved to position 1.');
  await expect(page.getByRole('button', { name: 'Move page 2 later' })).toBeFocused();
  await page.getByRole('button', { name: 'Turn page 1 right' }).click();
  await page.getByRole('button', { name: 'Remove page 3' }).click();
  await expect(page.getByRole('button', { name: 'Bring back page 3' })).toBeFocused();
  await expect(page.locator('#pagesStatus')).toHaveText('2 of 3 pages kept.');
  await expect(page.locator('.page-number')).toHaveText(['Page 2', 'Page 1', 'Page 3 removed']);

  // Mouse: drag page 3 (removed) to the front, then bring it back.
  await page.locator('.page-card').nth(2).dragTo(page.locator('.page-card').nth(0));
  await expect(page.locator('.page-number')).toHaveText(['Page 3 removed', 'Page 2', 'Page 1']);
  await page.getByRole('button', { name: 'Bring back page 3' }).click();

  await convert(page);
  const file = await download(page, 'mixed-organized.pdf');
  const pages = (await info(file)).pages;
  expect(pages.map((p) => p.size)).toEqual([[595, 842], [842, 595], [842, 595]]);
  expect(pages.map((p) => p.rotation)).toEqual([0, 0, 90]);
});

test('organize pages works on one PDF, and keeps at least one page', async ({ page }) => {
  await pickTool(page, 'organize');
  await addFiles(page, ['two-pages.pdf']);
  await expect(page.locator('.page-card')).toHaveCount(2);
  await page.getByRole('button', { name: 'Remove page 1' }).click();
  await page.getByRole('button', { name: 'Remove page 2' }).click();
  await convert(page);
  await expect(page.locator('#status')).toHaveText('Keep at least one page.');
  await page.locator('#resetPagesButton').click();
  await expect(page.locator('#pagesStatus')).toHaveText('2 of 2 pages kept.');

  await page.locator('#clearButton').click();
  await addFiles(page, ['two-pages.pdf', 'mixed.pdf']);
  await convert(page);
  await expect(page.locator('#status')).toHaveText('This tool works on one PDF at a time: remove the others.');
});

// Which pages of a PDF have dark marks in a region (see darkPixels).
async function marks(file, region) {
  const { runTool } = require('../engines');
  const { outputs } = await runTool('pdf-to-images', [{ path: file, name: 'check.pdf' }], { format: 'png', dpi: 50 }, test.info().outputPath('render'));
  return outputs.map((png) => darkPixels(png, region) > 0);
}

test.describe('page numbers and signatures', () => {
  test.skip(() => !engines().qpdf, 'qpdf is not installed');

  test('number the pages of a PDF, "Page 1 of 2" at the bottom', async ({ page }) => {
    await pickTool(page, 'page-numbers');
    await addFiles(page, ['two-pages.pdf']);
    await page.locator('#numberFormatSelect').selectOption({ label: 'Page 1 of 12' });
    await convert(page);
    const file = await download(page, 'two-pages-numbered.pdf');
    expect(await marks(file, [0.35, 0.88, 0.65, 1])).toEqual([true, true]);
  });

  test('sign the last page with a signature drawn with the mouse', async ({ page }) => {
    await pickTool(page, 'sign');
    await addFiles(page, ['mixed.pdf']);
    await convert(page);
    await expect(page.locator('#status')).toHaveText('Draw your signature, or type your name, first.');

    const box = await page.locator('#signaturePad').boundingBox();
    await page.mouse.move(box.x + 40, box.y + box.height * 0.7);
    await page.mouse.down();
    for (let i = 1; i <= 20; i++) await page.mouse.move(box.x + 40 + i * 15, box.y + box.height * (0.7 - 0.4 * Math.sin(i / 3)));
    await page.mouse.up();
    await convert(page);
    const file = await download(page, 'mixed-signed.pdf');
    expect(await marks(file, [0.55, 0.7, 1, 1])).toEqual([false, false, true]);
  });

  test('sign by typing your name, from the keyboard', async ({ page }) => {
    await pickTool(page, 'sign');
    await addFiles(page, ['two-pages.pdf']);
    await page.getByLabel('Or type your name').fill('Ada Lovelace');
    await page.getByLabel('Page', { exact: true }).fill('1');
    await page.locator('#signPositionSelect').selectOption('top-left');
    await convert(page);
    const file = await download(page, 'two-pages-signed.pdf');
    expect(await marks(file, [0, 0, 0.5, 0.25])).toEqual([true, false]);

    await page.locator('#clearSignatureButton').click();
    await expect(page.getByLabel('Or type your name')).toHaveValue('');
    await convert(page);
    await expect(page.locator('#status')).toHaveText('Draw your signature, or type your name, first.');
  });
});

test.describe('converting images', () => {
  test.skip(() => !engines().imagemagick, 'ImageMagick is not installed');

  test('turn a phone photo into a smaller, upright JPEG without its location', async ({ page }) => {
    const imagemagick = require('../engines/imagemagick');
    await pickTool(page, 'convert-images');
    await addFiles(page, ['phone-photo.jpg']);
    await page.locator('#imageFormatSelect').selectOption('jpeg');
    await page.locator('#qualityInput').fill('80');
    await page.locator('#maxSizeInput').fill('600');
    await expect(page.getByLabel('Remove location and other hidden details')).toBeChecked();
    await convert(page);
    const file = await download(page, 'phone-photo.jpg');
    expect(await imagemagick.identify(file, '%m %w %h')).toMatch(/^JPEG 600 4\d\d$/);
    expect(await imagemagick.identify(file, '%[EXIF:*]')).not.toMatch(/GPS/);
  });

  test('quality is only asked for formats that lose detail', async ({ page }) => {
    await pickTool(page, 'convert-images');
    await page.locator('#imageFormatSelect').selectOption('jpeg');
    await expect(page.locator('#qualityInput')).toBeVisible();
    await page.locator('#imageFormatSelect').selectOption('png');
    await expect(page.locator('#qualityInput')).toBeHidden();
  });
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
