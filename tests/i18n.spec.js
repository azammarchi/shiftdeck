// Translations: every language has every key, and switching language changes
// the interface and is remembered.
const { test, expect } = require('./fixtures');
const { openApp, pickTool } = require('./helpers');

test('every language has every English key', async ({ page }) => {
  await openApp(page);
  const missing = await page.evaluate(() => {
    const keys = Object.keys(LANGUAGES.en.strings);
    return Object.entries(LANGUAGES).flatMap(([code, language]) =>
      keys.filter((key) => !(key in language.strings)).map((key) => `${code}: ${key}`));
  });
  expect(missing).toEqual([]);
});

test('switching to Italian translates the page and is remembered', async ({ page }) => {
  await openApp(page);
  await pickTool(page, 'split');
  await page.getByLabel('Language').selectOption('it');
  await expect(page.locator('#toolTitle')).toHaveText('Dividi PDF');
  await expect(page.locator('#runLabel')).toHaveText('Converti');
  await expect(page.locator('html')).toHaveAttribute('lang', 'it');

  await page.reload();
  await expect(page.locator('#runLabel')).toHaveText('Converti');
  await expect(page.locator('legend')).toHaveText('Scegli uno strumento');
});

test('the language follows the browser on the first visit', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ locale: 'it-IT', baseURL });
  const page = await context.newPage();
  await openApp(page);
  await expect(page.locator('#runLabel')).toHaveText('Converti');
  await context.close();
});
