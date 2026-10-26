// The online demo (GitHub Pages): the same page, answering its own /api/
// requests in the browser. Opened here with ?demo, and checked to never
// reach the server, as on GitHub Pages, where there is none.
const fs = require('fs');
const { test, expect } = require('./fixtures');
const { addFiles, pickTool, convert, resultNames } = require('./helpers');
const { imageSize } = require('./sample-files');
const { info } = require('../engines');
const { readZip } = require('../lib/zip');

test.beforeEach(async ({ page }) => {
  page.on('request', (request) => {
    const { pathname } = new URL(request.url());
    if (pathname.startsWith('/api/') || pathname === '/events') throw new Error(`the demo reached the server: ${pathname}`);
  });
  await page.goto('/?demo');
  // Loaded: the first tool (Merge PDFs) says it needs the app.
  await expect(page.locator('#demoNotice')).toBeVisible();
  await expect(page.locator('#missingNotice')).toBeVisible();
});

async function save(page, link, name) {
  const started = page.waitForEvent('download');
  await link.click();
  const download = await started;
  expect(download.suggestedFilename()).toBe(name);
  const file = test.info().outputPath(name);
  await download.saveAs(file);
  return file;
}

test('tools that need the computer say how to get the app', async ({ page }) => {
  await expect(page.locator('#missingNotice')).toContainText('npm run setup');
  await expect(page.locator('#runButton')).toBeDisabled();
  await expect(page.locator('#demoNotice a')).toHaveAttribute('href', /github\.com\/azammarchi\/shiftdeck/);
});

test('convert images in the browser, and download them all as a ZIP', async ({ page }) => {
  await pickTool(page, 'convert-images');
  await expect(page.locator('#missingNotice')).toBeHidden();
  await expect(page.locator('#runButton')).toBeEnabled();
  await expect(page.locator('#imageFormatSelect option[value="heic"]')).toBeDisabled();
  await addFiles(page, ['p1.png', 'landscape.png']);
  await page.locator('#imageFormatSelect').selectOption('jpeg');
  await page.locator('#maxSizeInput').fill('500');
  await convert(page);
  expect(await resultNames(page)).toEqual(['p1.jpg', 'landscape.jpg']);

  const jpg = await save(page, page.locator('#resultList a').first(), 'p1.jpg');
  expect(imageSize(jpg)).toMatchObject({ format: 'jpeg', height: 500 });

  const zip = await save(page, page.getByRole('link', { name: 'Download all (ZIP)' }), 'p1-convert-images.zip');
  const files = readZip(fs.readFileSync(zip));
  expect(Object.keys(files)).toEqual(['p1.jpg', 'landscape.jpg']);
});

test('make a PDF from images in the browser', async ({ page }) => {
  await pickTool(page, 'images-to-pdf');
  await addFiles(page, ['p1.png', 'landscape.png']);
  await convert(page);
  const pdf = await save(page, page.locator('#resultList a').first(), 'p1.pdf');
  expect((await info(pdf)).pages.map((p) => p.size)).toEqual([[595, 842], [842, 595]]);
});
