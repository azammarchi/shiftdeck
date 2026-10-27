// Translations: every language has every key, with the same placeholders;
// switching language from the flag menu changes the interface and is
// remembered; right-to-left languages turn the page around.
const AxeBuilder = require('@axe-core/playwright').default;
const { test, expect } = require('./fixtures');
const { openApp, pickTool } = require('./helpers');

async function chooseLanguage(page, name) {
  await page.locator('#languageButton').click();
  await page.getByRole('option', { name }).click();
}

test('every language has every English key, with the same placeholders', async ({ page }) => {
  await openApp(page);
  const problems = await page.evaluate(async () => {
    await Promise.all(Object.keys(LANGUAGES).map(loadLanguage));
    const placeholders = (text) => (text.match(/\{\w+\}/g) || []).sort().join(' ');
    const out = [];
    for (const code of Object.keys(LANGUAGES)) {
      for (const [key, english] of Object.entries(STRINGS.en)) {
        const text = STRINGS[code][key];
        // Plural forms may differ by language (key_one, key_few...), so a
        // plural key only needs its _other form.
        if (text === undefined) {
          if (!/_(one|other)$/.test(key) || STRINGS[code][key.replace(/_one$/, '_other')] === undefined) out.push(`${code}: missing ${key}`);
        } else if (placeholders(text) !== placeholders(english) && !/_one$/.test(key)) {
          out.push(`${code}: ${key} has ${placeholders(text) || 'no placeholders'}, English has ${placeholders(english)}`);
        }
      }
      for (const key of Object.keys(STRINGS[code])) {
        if (!(key in STRINGS.en) && !/_(zero|one|two|few|many|other)$/.test(key)) out.push(`${code}: unknown key ${key}`);
      }
    }
    return out;
  });
  expect(problems).toEqual([]);
});

test('switching to Italian from the flag menu translates the page and is remembered', async ({ page }) => {
  await openApp(page);
  await pickTool(page, 'split');
  await chooseLanguage(page, 'Italiano');
  await expect(page.locator('#toolTitle')).toHaveText('Dividi PDF');
  await expect(page.locator('#runLabel')).toHaveText('Converti');
  await expect(page.locator('html')).toHaveAttribute('lang', 'it');
  await expect(page.locator('#languageButton')).toContainText('Italiano');
  await expect(page.locator('#languageButton')).toBeFocused();

  await page.reload();
  await expect(page.locator('#runLabel')).toHaveText('Converti');
  await expect(page.locator('#toolsHeading')).toHaveText('Scegli uno strumento');
});

test('the language menu works from the keyboard', async ({ page }) => {
  await openApp(page);
  await page.locator('#languageButton').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('option', { name: 'English' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('option', { name: 'Italiano' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#languageList')).toBeHidden();
  await expect(page.locator('#languageButton')).toBeFocused();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');

  await page.keyboard.press('Enter');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
});

test('Arabic turns the page right to left, with no accessibility problems', async ({ page }) => {
  await openApp(page);
  await chooseLanguage(page, 'العربية');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('#runLabel')).not.toHaveText('Convert');
  // The tool list sits on the right, next to the reading start.
  const tools = await page.locator('.tools').boundingBox();
  const workspace = await page.locator('.workspace').boundingBox();
  expect(tools.x).toBeGreaterThan(workspace.x);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);
});

test('counts use the right plural in each language', async ({ page }) => {
  await openApp(page);
  const texts = await page.evaluate(async () => {
    const out = [t('done', { count: 1 }), t('done', { count: 3 })];
    await setLanguage('it');
    out.push(t('done', { count: 1 }), t('done', { count: 3 }));
    return out;
  });
  expect(texts).toEqual(['Done: 1 file ready.', 'Done: 3 files ready.', 'Fatto: 1 file pronto.', 'Fatto: 3 file pronti.']);
});

test('the language follows the browser on the first visit', async ({ browser, baseURL }) => {
  for (const [locale, run] of [['it-IT', 'Converti'], ['de-DE', null]]) {
    const context = await browser.newContext({ locale, baseURL });
    const page = await context.newPage();
    await openApp(page);
    if (run) await expect(page.locator('#runLabel')).toHaveText(run);
    await expect(page.locator('html')).toHaveAttribute('lang', locale.slice(0, 2));
    await context.close();
  }
});
