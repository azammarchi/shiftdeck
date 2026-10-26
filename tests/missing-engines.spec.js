// What the app shows when the programs a tool needs aren't installed.
const { test, expect } = require('./fixtures');
const { pickTool } = require('./helpers');

test.describe('with no engines installed', () => {
  test.use({ serverEnv: { SHIFTDECK_DISABLE_ENGINES: 'pdfkit,qpdf,mutool,imagemagick' } });

  test('a tool says what is missing and how to install it', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#missingNotice')).toBeVisible();
    await expect(page.locator('#missingNotice')).toContainText('qpdf');
    await expect(page.locator('#missingNotice')).toContainText('npm run setup');
    await expect(page.locator('#runButton')).toBeDisabled();

    await pickTool(page, 'pdf-to-images');
    await expect(page.locator('#missingNotice')).toContainText(/qpdf, mutool,? and imagemagick/);
  });
});
