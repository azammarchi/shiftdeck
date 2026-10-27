// Opening Shiftdeck with files (the desktop launchers, `shiftdeck open`):
// the page lists them, picks the tool that suits them, and can run it.
const { test, expect } = require('./fixtures');
const { fileNames, convert, resultNames } = require('./helpers');
const { sample } = require('./sample-files');

const openWith = (names) => ({ serverEnv: { SHIFTDECK_OPEN: JSON.stringify(names.map(sample)) } });

async function load(page) {
  await page.goto('/');
  await expect(page.locator('#runButton')).toBeEnabled({ timeout: 20000 });
}

test.describe('two PDFs', () => {
  test.use(openWith(['three-pages.pdf', 'two-pages.pdf']));

  test('arrive listed, ready to merge', async ({ page }) => {
    await load(page);
    expect(await fileNames(page)).toEqual(['three-pages.pdf', 'two-pages.pdf']);
    await expect(page.locator('input[name="tool"][value="merge"]')).toBeChecked();
    await convert(page);
    expect(await resultNames(page)).toEqual(['three-pages-merged.pdf']);
  });
});

test.describe('one PDF', () => {
  test.use(openWith(['mixed.pdf']));

  test('opens on Organize pages, with its thumbnails', async ({ page }) => {
    await load(page);
    await expect(page.locator('input[name="tool"][value="organize"]')).toBeChecked();
    await expect(page.locator('.page-card')).toHaveCount(3);
  });
});

test.describe('pictures', () => {
  test.use(openWith(['p1.png', 'landscape.png']));

  test('open on Convert images', async ({ page }) => {
    await load(page);
    await expect(page.locator('input[name="tool"][value="convert-images"]')).toBeChecked();
    expect(await fileNames(page)).toEqual(['p1.png', 'landscape.png']);
  });

  test('are handed over once: reloading starts empty', async ({ page }) => {
    await load(page);
    await page.reload();
    await expect(page.locator('#runButton')).toBeEnabled({ timeout: 20000 });
    await expect(page.locator('#noFiles')).toBeVisible();
  });
});
