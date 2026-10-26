// Accessibility: automated WCAG 2.1 AA checks with axe-core on every tool and
// on results and errors, plus the keyboard path through a whole conversion.
const AxeBuilder = require('@axe-core/playwright').default;
const { test, expect } = require('./fixtures');
const { openApp, pickTool, addFiles, convert } = require('./helpers');

async function expectNoViolations(page, view) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
    .analyze();
  const summary = results.violations.map(
    (v) => `${view}: ${v.id} (${v.impact}) ${v.help} → ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
  );
  expect(summary).toEqual([]);
}

test('axe finds no WCAG 2.1 AA problems on any tool', async ({ page }) => {
  await openApp(page);
  for (const tool of ['merge', 'split', 'organize', 'pdf-to-images', 'images-to-pdf', 'convert-images', 'rotate', 'protect', 'unlock']) {
    await pickTool(page, tool);
    await expectNoViolations(page, tool);
  }
});

test('axe finds no problems with files, results and errors shown', async ({ page }) => {
  await openApp(page);
  await addFiles(page, ['three-pages.pdf', 'two-pages.pdf', 'notes.txt']);
  await convert(page);
  await expectNoViolations(page, 'error and invalid file');
  await page.getByRole('button', { name: 'Remove notes.txt' }).click();
  await convert(page);
  await expect(page.locator('#results')).toBeVisible();
  await expectNoViolations(page, 'results');
});

test('a whole conversion works from the keyboard', async ({ page }) => {
  await openApp(page);
  // Tools are radio buttons: arrows move between them.
  await page.locator('input[name="tool"][value="merge"]').focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('input[name="tool"][value="split"]')).toBeChecked();
  await expect(page.locator('#toolTitle')).toHaveText('Split PDF');

  await addFiles(page, ['two-pages.pdf']);
  await page.locator('#rangesInput').focus();
  await page.keyboard.type('1');
  await page.keyboard.press('Enter'); // submits the options form
  await expect(page.locator('#status')).toHaveText('Done: 1 file ready.');
  await expect(page.locator('#status')).toHaveAttribute('role', 'status');
});
