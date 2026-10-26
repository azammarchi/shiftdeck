const { test, expect } = require('./fixtures');
const { sample } = require('./sample-files');

async function openApp(page) {
  await page.goto('/');
  await expect(page.locator('#runButton')).toBeEnabled();
  await expect(page.locator('#missingNotice')).toBeHidden();
}

async function pickTool(page, name) {
  await page.locator(`.tool:has(input[value="${name}"])`).click();
  await expect(page.locator(`input[name="tool"][value="${name}"]`)).toBeChecked();
}

// Adds sample files through the file picker, as a user would, and waits until
// they're all loaded.
async function addFiles(page, names) {
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#chooseButton').click();
  await (await chooser).setFiles(names.map(sample));
  await expect(page.locator('#fileList li')).toHaveCount(names.length);
  await expect(page.locator('#fileList')).not.toContainText(/Loading|Caricamento/);
}

const fileNames = (page) => page.locator('#fileList .file-name').allTextContents();
const resultNames = (page) => page.locator('#resultList .file-name').allTextContents();

async function convert(page) {
  await page.locator('#runButton').click();
  await expect(page.locator('#status')).not.toHaveText(/Working|In corso/);
}

// Downloads one result through its link and returns the saved path. It's
// saved in the test's own output folder: Playwright keeps downloads in a
// hidden folder, which Ubuntu's AppArmor profile for qpdf won't let it open.
async function download(page, name) {
  const started = page.waitForEvent('download');
  await page.locator('#resultList li').filter({ hasText: name }).getByRole('link').click();
  const file = await started;
  expect(file.suggestedFilename()).toBe(name);
  const saved = test.info().outputPath(name);
  await file.saveAs(saved);
  return saved;
}

module.exports = { openApp, pickTool, addFiles, fileNames, resultNames, convert, download };
